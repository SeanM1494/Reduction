/**
 * server/lib/billing/apple.ts — the App Store adapter.
 *
 * THE ONLY FILE THAT MAY IMPORT @apple/app-store-server-library OR NAME AN
 * APPLE-SHAPED FIELD. Same rule, same reason, as stripe.ts: everything else
 * asks `entitlementFor(userId)` and branches on the answer, so an
 * `originalTransactionId`, an `autoRenewStatus` or a `BILLING_RETRY` that
 * escapes this file is provider vocabulary that will outlive the provider.
 *
 * WHAT APPLE GIVES US, AND FROM WHERE. StoreKit 2 hands the app a signed
 * transaction (a JWS — `Transaction.jwsRepresentation`) and, for a
 * subscription, signed renewal info. Apple's servers send the same two
 * objects in every App Store Server Notification (V2), wrapped in a third
 * JWS. All three are signed with a certificate chain rooted at Apple's
 * public root CAs, so verification needs no shared secret — just the roots,
 * which is why there is no "webhook secret" here and why the notifications
 * route is gated on having the roots rather than on a header.
 *
 * TWO WRITE PATHS, ONE TABLE ROW. `POST /api/billing/apple/verify` is the
 * app reporting a purchase it just made (so the paywall lifts immediately);
 * the notifications route is Apple reporting everything after that —
 * renewals, billing failures, cancellations, refunds. Both end in
 * `upsertAppleSubscription`, keyed on (provider='apple', provider_ref=
 * originalTransactionId), so they converge whichever arrives first and
 * however many times Apple redelivers.
 *
 * WHICH ACCOUNT. The app stamps `appAccountToken` on the purchase — Apple
 * requires a UUID, and `users.id` is a v4 UUID, so it is the user id itself,
 * no lookup table (the same trick stripe.ts plays with subscription
 * metadata). The fallback is the row already stored for that
 * originalTransactionId, which covers a notification for a purchase made
 * before the app set the token, or a restore on a new device.
 *
 * TWO ENVIRONMENTS, ONE SERVER. App Review and TestFlight make SANDBOX
 * purchases against the PRODUCTION deployment — there is no other server
 * for them to reach — so a verifier bound to one environment fails every
 * review with "could not complete the purchase" (the first cut did exactly
 * that, and never met a reviewer only because it never shipped). Apple's
 * guidance is to accept the environment the signed payload declares, and
 * that is what happens: every JWS carries an `environment` claim (a
 * notification carries it under `data`), `environmentDeclaredBy` reads it
 * UNVERIFIED, and the verifier built for that environment does the
 * verification — which includes checking the claim, so a lie only selects
 * the verifier that will refuse it. `APPLE_IAP_ENVIRONMENT` is therefore
 * not "which payloads to accept" but "which environment this server SELLS
 * in": Production requires `APPLE_APP_APPLE_ID` (the library needs it to
 * bind a production payload to the app), Sandbox does not, and the wall
 * shows a price only when the selling environment can be verified. Sandbox
 * testers exist only where this team creates them, which is why accepting
 * their purchases in production is Apple's recommendation and not a hole.
 *
 * WHAT THE LIBRARY IS FOR AND WHAT IT IS NOT. `SignedDataVerifier` does the
 * x5c chain walk to Apple's roots, the OCSP check, and the bundle/environment
 * binding — the part where a hand-rolled version fails silently and
 * permanently. It is used for that and nothing else. The App Store Server
 * API calls are made here directly, because the library hard-codes Apple's
 * hosts and this suite has to be able to point them at a loopback stub, the
 * way EXPO_PUSH_URL and ANTHROPIC_BASE_URL already do. The JWT those calls
 * carry is the same ES256 recipe as Sign in with Apple's client secret —
 * including `dsaEncoding: "ieee-p1363"`, see lib/apple.ts for the afternoon
 * that option saves.
 *
 * WHAT CANNOT BE VERIFIED HERE. Apple's hosts are unreachable from the
 * development container, and Apple's root certificates cannot be downloaded
 * from it. What the suite proves is the status translation, the row the
 * adapter writes, the account-binding rules, the routes' gates, and the API
 * client's request shape against a stub. A real signed payload has never
 * been through this code. Before relying on it: drop the roots in, run a
 * sandbox purchase, and request a test notification from the preflight route.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  AutoRenewStatus,
  Environment,
  SignedDataVerifier,
  Status,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { getDb } from "../../db";
import { subscriptions, users } from "@workspace/db";
import { normalisePem } from "../apple";
import type { SubStatus } from "./entitlement";

export const APPLE_PROVIDER = "apple";

// ------------------------------------------------------------------ config ---

export type AppleEnvironment = "Sandbox" | "Production";

export interface AppleApiCredentials {
  /** Key ID of an In-App Purchase key (App Store Connect → Users and Access →
   *  Integrations → In-App Purchase). NOT the Sign in with Apple key. */
  keyId: string;
  /** The Issuer ID shown on that same page. */
  issuerId: string;
  privateKeyPem: string;
}

export interface AppleIapConfig {
  bundleId: string;
  /** The environment this server SELLS in — the default for an outbound
   *  call with no payload to read one from (the preflight's test
   *  notification), and the one `nativePurchaseAvailable` vouches for.
   *  Verification accepts every environment in `verifies`. */
  environment: AppleEnvironment;
  /** Which environments this process can verify: Sandbox always (roots are
   *  enough), Production once APPLE_APP_APPLE_ID is set. */
  verifies: AppleEnvironment[];
  /** Apple's root CAs, DER. Required; verification is impossible without. */
  rootCerts: Buffer[];
  /** The numeric App Store id. The library insists on it for Production. */
  appAppleId: number | null;
  /** Optional: without these the verify route still works from the signed
   *  transaction alone and the status refresh is skipped. */
  api: AppleApiCredentials | null;
  /** OCSP revocation checks against Apple. On unless APPLE_IAP_OFFLINE=1. */
  onlineChecks: boolean;
}

/**
 * Apple's roots, from whichever of two places the operator put them.
 *
 * APPLE_ROOT_CERTS: base64 of each .cer (DER), separated by commas or
 * whitespace — the shape a Secrets UI can hold. Or APPLE_ROOT_CA_DIR: a
 * directory of .cer/.der files, for a checkout that has them on disk. Both
 * come from https://www.apple.com/certificateauthority/ — "Apple Root CA -
 * G3" is the one that signs App Store payloads today; G2 costs nothing to
 * include. They are public; nothing here is a secret.
 */
function loadRootCerts(): Buffer[] {
  const out: Buffer[] = [];
  const inline = process.env.APPLE_ROOT_CERTS?.trim();
  if (inline) {
    for (const part of inline.split(/[\s,]+/).filter(Boolean)) {
      try {
        const der = Buffer.from(part, "base64");
        new crypto.X509Certificate(der); // parse check only
        out.push(der);
      } catch {
        // Reported by describeAppleIapEnv; skipped here so one bad paste
        // does not take the good one down with it.
      }
    }
  }
  const dir = process.env.APPLE_ROOT_CA_DIR?.trim();
  if (dir) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /\.(cer|der|crt)$/i.test(n));
    } catch {
      names = [];
    }
    for (const n of names) {
      try {
        const buf = fs.readFileSync(path.join(dir, n));
        // A .crt may be PEM; the library wants DER.
        const der = buf.toString("latin1").includes("-----BEGIN")
          ? Buffer.from(new crypto.X509Certificate(buf).raw)
          : buf;
        new crypto.X509Certificate(der);
        out.push(der);
      } catch {
        /* reported by describeAppleIapEnv */
      }
    }
  }
  return out;
}

function apiCredentials(): AppleApiCredentials | null {
  const keyId = process.env.APPLE_IAP_KEY_ID?.trim();
  const issuerId = process.env.APPLE_IAP_ISSUER_ID?.trim();
  const rawKey = process.env.APPLE_IAP_PRIVATE_KEY;
  if (!keyId || !issuerId || !rawKey) return null;
  return { keyId, issuerId, privateKeyPem: normalisePem(rawKey) };
}

function environmentFromEnv(): AppleEnvironment {
  // Production unless told otherwise: the fail-closed direction for SELLING.
  // A production server without the App Store id cannot verify a production
  // purchase, so it must not offer one. Sandbox is what a workspace server
  // sells in while testing; set it explicitly there.
  const raw = process.env.APPLE_IAP_ENVIRONMENT?.trim().toLowerCase();
  return raw === "sandbox" ? "Sandbox" : "Production";
}

let cachedConfig: AppleIapConfig | null | undefined;

/** Null when the adapter cannot verify anything — no bundle id, or no roots,
 *  or Production without the App Store id the library requires. Memoised;
 *  the roots are files. */
export function appleIapConfig(): AppleIapConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim();
  const environment = environmentFromEnv();
  const appAppleIdRaw = process.env.APPLE_APP_APPLE_ID?.trim();
  const appAppleId = appAppleIdRaw && /^\d+$/.test(appAppleIdRaw) ? Number(appAppleIdRaw) : null;
  const rootCerts = loadRootCerts();
  if (!bundleId || !rootCerts.length || (environment === "Production" && appAppleId === null)) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    bundleId,
    environment,
    verifies: appAppleId === null ? ["Sandbox"] : ["Sandbox", "Production"],
    rootCerts,
    appAppleId,
    api: apiCredentials(),
    onlineChecks: process.env.APPLE_IAP_OFFLINE?.trim() !== "1",
  };
  return cachedConfig;
}

/** Test seam, and what to call after changing the secrets by hand. */
export function resetAppleIapCache(): void {
  cachedConfig = undefined;
  verifier = null;
  apiJwtCache = null;
}

// ---------------------------------------------------------------- verifier ---

/**
 * The three verifications the adapter needs, behind an interface so the
 * suite can substitute decoded payloads for signed ones. The production
 * implementation is the library; nothing else in this file touches it.
 */
export interface AppleVerifier {
  notification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
  transaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload>;
  renewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload>;
}

let verifier: AppleVerifier | null = null;
let injected: AppleVerifier | null = null;

/**
 * The environment a JWS says it is from, read WITHOUT verifying it. A
 * transaction and a renewal info carry `environment` at the top level; a
 * notification carries it under `data`. Anything unreadable, or an
 * environment this adapter does not know (Xcode, LocalTesting), is null and
 * the caller falls back to the server's own. This is only ever used to
 * choose which verifier to run — the verifier then checks the same claim
 * against the signature, so a forged claim buys nothing.
 */
export function environmentDeclaredBy(jws: string): AppleEnvironment | null {
  const seg = jws.split(".")[1];
  if (!seg) return null;
  try {
    const body = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as {
      environment?: unknown;
      data?: { environment?: unknown };
    };
    const raw = body.environment ?? body.data?.environment;
    return raw === "Sandbox" || raw === "Production" ? raw : null;
  } catch {
    return null;
  }
}

/** The environment a VERIFIED transaction is from, in this file's terms. */
export function environmentOfTransaction(tx: JWSTransactionDecodedPayload): AppleEnvironment {
  return tx.environment === Environment.SANDBOX ? "Sandbox" : "Production";
}

/** Thrown when a payload declares an environment this process has no
 *  verifier for — a production purchase reaching a server with no
 *  APPLE_APP_APPLE_ID. Distinct from the library's INVALID_ENVIRONMENT,
 *  which means the signature disagreed with the claim. */
export class AppleEnvironmentUnconfigured extends Error {
  constructor(public readonly environment: AppleEnvironment) {
    super(`No verifier for ${environment} payloads: ${environment === "Production" ? "APPLE_APP_APPLE_ID is unset" : "unconfigured"}.`);
  }
}

/**
 * One verifier that dispatches on the payload's declared environment.
 * Exported with its factory injectable so the dispatch is provable under
 * node without a signature: the real factory builds the library's verifier,
 * the suite hands in fakes.
 */
export function selectingVerifier(
  cfg: Pick<AppleIapConfig, "environment" | "verifies">,
  build: (env: AppleEnvironment) => AppleVerifier
): AppleVerifier {
  const built = new Map<AppleEnvironment, AppleVerifier>();
  const pick = (jws: string): AppleVerifier => {
    const env = environmentDeclaredBy(jws) ?? cfg.environment;
    if (!cfg.verifies.includes(env)) throw new AppleEnvironmentUnconfigured(env);
    let v = built.get(env);
    if (!v) {
      v = build(env);
      built.set(env, v);
    }
    return v;
  };
  // async, so a missing verifier is a REJECTION like every other failure
  // here, never a synchronous throw that only a try block around the call
  // would catch.
  return {
    notification: async (s) => pick(s).notification(s),
    transaction: async (s) => pick(s).transaction(s),
    renewalInfo: async (s) => pick(s).renewalInfo(s),
  };
}

function libraryVerifier(cfg: AppleIapConfig): AppleVerifier {
  return selectingVerifier(cfg, (env) => {
    const v = new SignedDataVerifier(
      cfg.rootCerts,
      cfg.onlineChecks,
      env === "Sandbox" ? Environment.SANDBOX : Environment.PRODUCTION,
      cfg.bundleId,
      cfg.appAppleId ?? undefined
    );
    return {
      notification: (s) => v.verifyAndDecodeNotification(s),
      transaction: (s) => v.verifyAndDecodeTransaction(s),
      renewalInfo: (s) => v.verifyAndDecodeRenewalInfo(s),
    };
  });
}

/** The verifier for the current config, or null when unconfigured. */
export function appleVerifier(): AppleVerifier | null {
  if (injected) return injected;
  if (verifier) return verifier;
  const cfg = appleIapConfig();
  if (!cfg) return null;
  verifier = libraryVerifier(cfg);
  return verifier;
}

/** TEST SEAM. A stub here bypasses signature verification entirely — which
 *  is the point in a test and a catastrophe anywhere else, so it refuses to
 *  be set outside the test runner. */
export function setAppleVerifierForTests(v: AppleVerifier | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setAppleVerifierForTests is a test seam and must not be called in production.");
  }
  injected = v;
}

/**
 * Turn a library verification failure into something a route can answer
 * with, and a log line can name. Everything else is rethrown.
 */
export function describeVerificationFailure(e: unknown): string | null {
  if (e instanceof AppleEnvironmentUnconfigured) return `${e.environment.toLowerCase()}_unconfigured`;
  if (!(e instanceof VerificationException)) return null;
  switch (e.status) {
    case VerificationStatus.INVALID_APP_IDENTIFIER:
      return "wrong_app";
    case VerificationStatus.INVALID_ENVIRONMENT:
      return "wrong_environment";
    case VerificationStatus.INVALID_CHAIN_LENGTH:
    case VerificationStatus.INVALID_CERTIFICATE:
      return "bad_certificate_chain";
    case VerificationStatus.RETRYABLE_VERIFICATION_FAILURE:
      return "retryable";
    default:
      return "bad_signature";
  }
}

// ------------------------------------------------------------- translation ---

/**
 * THE TRANSLATION, and the only place Apple's statuses may appear.
 *
 * Apple's subscription status (from the Server API and from a notification's
 * `data.status`) is a small enum, and it maps cleanly: 1 ACTIVE is active;
 * 3 BILLING_RETRY and 4 BILLING_GRACE_PERIOD are both "Apple is still trying
 * to collect", which is exactly what grace means here — the provider's retry
 * window, never a local timer; 2 EXPIRED and 5 REVOKED are over. Grace ends
 * when Apple says so (an EXPIRED or GRACE_PERIOD_EXPIRED notification), the
 * same contract stripe.ts keeps with `past_due`.
 */
export function normaliseAppleStatus(status: Status | number): SubStatus {
  switch (status) {
    case Status.ACTIVE:
      return "active";
    case Status.BILLING_RETRY:
    case Status.BILLING_GRACE_PERIOD:
      return "grace";
    case Status.EXPIRED:
    case Status.REVOKED:
      return "expired";
    default:
      // A status Apple adds after this was written. Expired is the safe
      // direction — it under-serves rather than giving away access, and it
      // shows up in access_events as an account to investigate.
      return "expired";
  }
}

export interface AppleSubscriptionFacts {
  /** The originalTransactionId — the one id that survives every renewal. */
  providerRef: string;
  status: SubStatus;
  renewsAt: Date | null;
  willNotRenew: boolean;
}

/**
 * What a signed transaction (plus, when present, its renewal info and an
 * explicit status) says about the subscription, in this app's terms.
 *
 * An explicit status from Apple wins — it is the authoritative answer and it
 * knows things the dates do not (a revocation, a grace period Apple granted).
 * Without one, the dates decide: a revocation date means refunded/revoked;
 * an expiry in the future is active; an expiry in the past is grace while
 * Apple says it is still retrying (`isInBillingRetryPeriod`, or a grace
 * period that has not itself expired), and expired otherwise.
 *
 * `renewsAt` is when access lapses if nothing changes: the grace period's
 * end while in grace, the expiry otherwise. `willNotRenew` is auto-renew
 * turned off, which is how an Apple subscription is "cancelled" — it runs to
 * the end of the paid period, exactly like Stripe's cancel_at_period_end.
 */
export function subscriptionFromApple(input: {
  transaction: JWSTransactionDecodedPayload;
  renewalInfo?: JWSRenewalInfoDecodedPayload | null;
  status?: Status | number | null;
  now?: number;
}): AppleSubscriptionFacts | null {
  const { transaction: tx, renewalInfo: ri } = input;
  const now = input.now ?? Date.now();
  const providerRef = tx.originalTransactionId ?? tx.transactionId;
  if (!providerRef) return null;

  const expires = typeof tx.expiresDate === "number" ? tx.expiresDate : null;
  const graceEnd = typeof ri?.gracePeriodExpiresDate === "number" ? ri.gracePeriodExpiresDate : null;

  let status: SubStatus;
  if (input.status != null) {
    status = normaliseAppleStatus(input.status);
  } else if (typeof tx.revocationDate === "number") {
    status = "expired";
  } else if (expires === null) {
    // Not a subscription at all (a consumable, a non-renewing purchase).
    // Nothing this app sells is one, so treat it as nothing.
    return null;
  } else if (expires > now) {
    status = "active";
  } else if (ri?.isInBillingRetryPeriod || (graceEnd !== null && graceEnd > now)) {
    status = "grace";
  } else {
    status = "expired";
  }

  const renewsAt =
    status === "grace" && graceEnd !== null
      ? new Date(graceEnd)
      : expires !== null
        ? new Date(expires)
        : null;

  return {
    providerRef,
    status,
    renewsAt,
    willNotRenew: ri?.autoRenewStatus === AutoRenewStatus.OFF,
  };
}

// --------------------------------------------------------------- the table ---

/**
 * Write an Apple subscription into the provider-agnostic table.
 *
 * Keyed on (provider, provider_ref) like every other adapter, so the verify
 * route and a redelivered notification converge on one row. `raw` keeps the
 * decoded transaction and renewal info — never the JWS strings, which are
 * large and say nothing a human can read.
 */
export async function upsertAppleSubscription(params: {
  userId: string;
  facts: AppleSubscriptionFacts;
  transaction: JWSTransactionDecodedPayload;
  renewalInfo?: JWSRenewalInfoDecodedPayload | null;
  notificationType?: string | null;
}): Promise<void> {
  const { userId, facts } = params;
  const values = {
    userId,
    provider: APPLE_PROVIDER,
    provider_ref: facts.providerRef,
    status: facts.status,
    renewsAt: facts.renewsAt,
    willNotRenew: facts.willNotRenew,
    raw: {
      transaction: params.transaction,
      renewalInfo: params.renewalInfo ?? null,
      notificationType: params.notificationType ?? null,
    } as Record<string, unknown>,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(subscriptions)
    .values({ id: crypto.randomUUID(), ...values })
    .onConflictDoUpdate({
      target: [subscriptions.provider, subscriptions.provider_ref],
      set: values,
    });
}

/** The account a stored Apple subscription belongs to, if we have one. */
export async function storedOwnerOfAppleSubscription(providerRef: string): Promise<string | null> {
  const rows = await getDb()
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, APPLE_PROVIDER), eq(subscriptions.provider_ref, providerRef)));
  return rows[0]?.userId ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which account a transaction belongs to.
 *
 * `appAccountToken` first — the app sets it to `users.id` at purchase, so
 * it is the user id, not a key into anything. It is CHECKED against the users
 * table rather than trusted: Apple only guarantees it is a UUID the app
 * supplied, and a token naming no account must not create a dangling row.
 * Then the row already stored for this originalTransactionId.
 */
export async function userIdForAppleTransaction(
  tx: JWSTransactionDecodedPayload
): Promise<string | null> {
  const token = tx.appAccountToken?.trim().toLowerCase();
  if (token && UUID_RE.test(token)) {
    const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.id, token));
    if (rows[0]) return rows[0].id;
  }
  const ref = tx.originalTransactionId ?? tx.transactionId;
  return ref ? storedOwnerOfAppleSubscription(ref) : null;
}

// ------------------------------------------------- App Store Server API ---

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url").replace(/=+$/, "");

/** Apple caps these at 60 minutes. Twenty leaves room for clock skew. */
const API_JWT_TTL_MS = 20 * 60 * 1000;
let apiJwtCache: { token: string; expiresAt: number; keyId: string } | null = null;

/**
 * The App Store Server API bearer token: ES256, `iss` the Issuer ID, `bid`
 * the bundle id, `aud` fixed. The signature MUST be IEEE P1363 (r||s, 64
 * bytes), not DER — see clientSecret in lib/apple.ts, which learned that the
 * hard way. Cached well short of expiry and keyed on the Key ID so a rotated
 * key takes effect on the next call.
 */
export function appStoreApiJwt(cfg: AppleIapConfig, now = Date.now()): string {
  if (!cfg.api) throw new Error("App Store Server API credentials are not configured.");
  if (apiJwtCache && apiJwtCache.keyId === cfg.api.keyId && apiJwtCache.expiresAt - 60_000 > now) {
    return apiJwtCache.token;
  }
  const header = { alg: "ES256", kid: cfg.api.keyId, typ: "JWT" };
  const payload = {
    iss: cfg.api.issuerId,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + API_JWT_TTL_MS) / 1000),
    aud: "appstoreconnect-v1",
    bid: cfg.bundleId,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(cfg.api.privateKeyPem);
  } catch (e) {
    throw new Error(
      `APPLE_IAP_PRIVATE_KEY is not a readable PEM private key (${(e as Error).message}). ` +
        "Paste the whole .p8 file including the BEGIN and END lines."
    );
  }
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  const token = `${signingInput}.${b64url(signature)}`;
  apiJwtCache = { token, expiresAt: now + API_JWT_TTL_MS, keyId: cfg.api.keyId };
  return token;
}

/** Apple's hosts per environment, or the suite's loopback stub. The
 *  environment is the TRANSACTION's, when there is one — a sandbox
 *  purchase verified by the production server is looked up at the sandbox
 *  host, where it exists. */
export function appStoreApiBase(cfg: AppleIapConfig, environment: AppleEnvironment = cfg.environment): string {
  const override = process.env.APPLE_STOREKIT_API_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return environment === "Sandbox"
    ? "https://api.storekit-sandbox.itunes.apple.com"
    : "https://api.storekit.apple.com";
}

export interface AppleStatusSnapshot {
  status: Status | number;
  signedTransactionInfo: string | null;
  signedRenewalInfo: string | null;
}

/**
 * Get All Subscription Statuses, narrowed to one originalTransactionId.
 *
 * Returns null — rather than throwing — when the API is unconfigured, the
 * call fails, or Apple does not know the id: the verify route then falls
 * back to what the signed transaction itself says, which is merely less
 * current, not wrong. A thrown error here would turn "Apple is slow" into
 * "your purchase did not count".
 */
export async function fetchAppleSubscriptionStatus(
  cfg: AppleIapConfig,
  originalTransactionId: string,
  environment: AppleEnvironment = cfg.environment
): Promise<AppleStatusSnapshot | null> {
  if (!cfg.api) return null;
  try {
    const res = await fetch(
      `${appStoreApiBase(cfg, environment)}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
      {
        headers: { Authorization: `Bearer ${appStoreApiJwt(cfg)}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) {
      console.error(`[billing:apple] status lookup failed (${res.status})`);
      return null;
    }
    const body = (await res.json()) as {
      data?: Array<{
        lastTransactions?: Array<{
          originalTransactionId?: string;
          status?: number;
          signedTransactionInfo?: string;
          signedRenewalInfo?: string;
        }>;
      }>;
    };
    for (const group of body.data ?? []) {
      for (const t of group.lastTransactions ?? []) {
        if (t.originalTransactionId === originalTransactionId && typeof t.status === "number") {
          return {
            status: t.status,
            signedTransactionInfo: t.signedTransactionInfo ?? null,
            signedRenewalInfo: t.signedRenewalInfo ?? null,
          };
        }
      }
    }
    return null;
  } catch (e) {
    console.error("[billing:apple] status lookup failed:", (e as Error).message);
    return null;
  }
}

/**
 * Ask Apple to send a TEST notification to the configured notifications
 * URL. The one way to prove, from Apple's side, that the URL is registered,
 * reachable and verifying — which nothing in this container can.
 */
export async function requestAppleTestNotification(
  cfg: AppleIapConfig
): Promise<{ ok: true; token: string } | { ok: false; status: number; detail: string }> {
  if (!cfg.api) return { ok: false, status: 0, detail: "App Store Server API credentials are not configured." };
  try {
    const res = await fetch(`${appStoreApiBase(cfg)}/inApps/v1/notifications/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${appStoreApiJwt(cfg)}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { testNotificationToken?: string; errorMessage?: string };
    if (!res.ok || !body.testNotificationToken) {
      return { ok: false, status: res.status, detail: body.errorMessage ?? "no detail" };
    }
    return { ok: true, token: body.testNotificationToken };
  } catch (e) {
    return { ok: false, status: 0, detail: (e as Error).message };
  }
}

// --------------------------------------------------------------- preflight ---

/**
 * What the running process holds, for GET /api/admin/preflight/apple-iap.
 * Discloses nothing secret: certificate subjects and expiries are public,
 * the key is reported only as "parses", ids are not secrets.
 */
export function describeAppleIapEnv(): Record<string, unknown> {
  const cfg = appleIapConfig();
  const inline = process.env.APPLE_ROOT_CERTS?.trim();
  const inlineParts = inline ? inline.split(/[\s,]+/).filter(Boolean) : [];
  const inlineUnparseable = inlineParts.filter((part) => {
    try {
      new crypto.X509Certificate(Buffer.from(part, "base64"));
      return false;
    } catch {
      return true;
    }
  }).length;
  const roots = loadRootCerts().map((der) => {
    const c = new crypto.X509Certificate(der);
    return { subject: c.subject.replace(/\n/g, ", "), validTo: c.validTo, isApple: /Apple/i.test(c.subject) };
  });
  const api = apiCredentials();
  let apiKeyParses = false;
  let apiKeyError: string | null = null;
  if (api) {
    try {
      crypto.createPrivateKey(api.privateKeyPem);
      apiKeyParses = true;
    } catch (e) {
      apiKeyError = (e as Error).message;
    }
  }
  const environment = environmentFromEnv();
  const present = {
    APPLE_BUNDLE_ID: !!process.env.APPLE_BUNDLE_ID?.trim(),
    APPLE_ROOT_CERTS_or_APPLE_ROOT_CA_DIR: roots.length > 0,
    APPLE_APP_APPLE_ID: !!process.env.APPLE_APP_APPLE_ID?.trim(),
  };
  const missing = Object.entries(present)
    .filter(([k, v]) => !v && (k !== "APPLE_APP_APPLE_ID" || environment === "Production"))
    .map(([k]) => k);
  return {
    configured: cfg !== null,
    missing,
    environment,
    // What this process will verify. A production deployment must list
    // both: App Review's purchases are Sandbox and arrive here.
    verifies: cfg?.verifies ?? [],
    bundleId: process.env.APPLE_BUNDLE_ID?.trim() || null,
    appAppleId: cfg?.appAppleId ?? null,
    rootCertificates: roots,
    rootCertificatesDroppedAsUnparseable: inlineUnparseable,
    onlineChecks: process.env.APPLE_IAP_OFFLINE?.trim() !== "1",
    serverApi: api
      ? { configured: true, keyId: api.keyId, issuerId: api.issuerId, privateKeyParses: apiKeyParses, parseError: apiKeyError }
      : { configured: false, note: "APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID and APPLE_IAP_PRIVATE_KEY unset — the verify route still works from the signed transaction; status refresh and test notifications are off." },
    notificationsUrl: process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, "")}/api/billing/apple/notifications`
      : null,
  };
}
