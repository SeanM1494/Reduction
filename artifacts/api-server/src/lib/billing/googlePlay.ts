/**
 * server/lib/billing/googlePlay.ts — the Google Play adapter.
 *
 * THE ONLY FILE THAT MAY NAME A PLAY-SHAPED FIELD. Same rule, same reason,
 * as stripe.ts and apple.ts: everything else asks `entitlementFor(userId)`,
 * so a `subscriptionState`, an `acknowledgementState` or a
 * `linkedPurchaseToken` that escapes this file is provider vocabulary that
 * will outlive the provider. What leaves here is a SubStatus, a date, a
 * user id and a purchase token.
 *
 * WHAT PLAY GIVES US, AND WHY IT IS NOT LIKE APPLE. The phone's purchase
 * carries a PURCHASE TOKEN: an opaque string, not a signed object. Nothing
 * about it can be checked locally; the proof is asking Google, with this
 * app's service account, what that token is (Play Developer API,
 * `purchases.subscriptionsv2.get`). So both write paths — the app's verify
 * call and Google's Real-Time Developer Notifications — end in the same
 * LOOKUP, never in trusting a payload: a notification only names a token,
 * and the row is written from Google's answer about it. That is also why a
 * forged notification is harmless (it can only make this server re-read a
 * real token's state), and the shared token on the notifications URL is
 * there to keep strangers from spending API quota, not to prove anything.
 *
 * ONE ROW PER PURCHASE TOKEN. `provider_ref` is the token, which stays the
 * same across renewals. An upgrade, a downgrade or a resubscribe after
 * expiry issues a NEW token naming the old one as `linkedPurchaseToken`;
 * the new token gets its own row and the old row is closed, so an account
 * never holds a stale "active" that Google has replaced.
 *
 * WHICH ACCOUNT. The app sets `obfuscatedAccountId` to `users.id` at
 * purchase, and Play returns it as `obfuscatedExternalAccountId` — the same
 * no-lookup-table trick as Apple's appAccountToken and Stripe's metadata.
 * Checked against the users table rather than trusted, then the row already
 * stored for the token (or for the token it replaced).
 *
 * ACKNOWLEDGE, OR GOOGLE REFUNDS IT. A subscription purchase that is not
 * acknowledged within three days is refunded and revoked. The app
 * acknowledges after the server has verified (lib/storeKit.ts), and this
 * server acknowledges too, at verify and at every notification, because a
 * phone can be closed between the two steps. Acknowledging twice is
 * refused by Google harmlessly.
 *
 * GRACE IS GOOGLE'S, AS IT IS STRIPE'S. `IN_GRACE_PERIOD` maps to 'grace'
 * and stays there until Google says otherwise; the grace period's length
 * is a Play Console setting, never a constant here. `ON_HOLD` (grace ran
 * out, Google still retrying) maps to 'expired', because Google says to
 * withhold access then; it comes back as 'active' on recovery, by
 * notification.
 *
 * WHAT CANNOT BE VERIFIED HERE. No Play app, product or service account
 * exists yet, so no real token has ever been looked up. The suite runs the
 * token exchange and every API call against a loopback stub
 * (GOOGLE_OAUTH_TOKEN_URL, GOOGLE_PLAY_API_URL), the way apple.ts points
 * its Server API at one. The field names are Google's documented ones; the
 * first real exercise is a license-tester purchase on a testing track.
 */

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { subscriptions, users } from "@workspace/db";
import type { SubStatus } from "./entitlement";

export const GOOGLE_PLAY_PROVIDER = "google_play";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_API = "https://androidpublisher.googleapis.com";

// ------------------------------------------------------------ config ---

export interface GooglePlayConfig {
  packageName: string;
  clientEmail: string;
  privateKeyPem: string;
  privateKeyId: string | null;
  tokenUri: string;
  /** The shared token on the notifications URL; null leaves that route
   *  absent (verify still works). */
  rtdnToken: string | null;
}

interface ServiceAccountJson {
  client_email?: unknown;
  private_key?: unknown;
  private_key_id?: unknown;
  token_uri?: unknown;
}

/**
 * The service account key as pasted: the JSON file Google Cloud hands out,
 * or the same base64-encoded (some secrets UIs mangle multi-line JSON).
 * Null when it is neither.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccountJson | null {
  const s = raw?.trim();
  if (!s) return null;
  const tryJson = (t: string): ServiceAccountJson | null => {
    try {
      const v = JSON.parse(t) as unknown;
      return v && typeof v === "object" ? (v as ServiceAccountJson) : null;
    } catch {
      return null;
    }
  };
  return tryJson(s) ?? (/^[A-Za-z0-9+/=_-]+$/.test(s) ? tryJson(Buffer.from(s, "base64").toString("utf8")) : null);
}

/** A key whose newlines arrived as literal "\n" (pasted out of the JSON by
 *  hand) is repaired; PEM line breaks are formatting, not data. */
const repairPem = (k: string) => (k.includes("\\n") ? k.replace(/\\n/g, "\n") : k).trim() + "\n";

let configCache: { key: string; cfg: GooglePlayConfig | null } | null = null;

/** Tests change the environment between cases. */
export function resetGooglePlayCache(): void {
  configCache = null;
  accessTokenCache = null;
}

/**
 * The adapter's configuration, or null when it is not configured — in
 * which case the app is told it cannot sell on Android and the routes
 * answer 503/404, exactly the posture of an unconfigured Apple adapter.
 */
export function googlePlayConfig(): GooglePlayConfig | null {
  const env = process.env;
  const key = [env.GOOGLE_PLAY_PACKAGE_NAME, env.GOOGLE_PLAY_SERVICE_ACCOUNT, env.GOOGLE_PLAY_RTDN_TOKEN].join("\u0000");
  if (configCache?.key === key) return configCache.cfg;
  let cfg: GooglePlayConfig | null = null;
  const packageName = env.GOOGLE_PLAY_PACKAGE_NAME?.trim();
  const sa = parseServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT);
  if (packageName && sa && typeof sa.client_email === "string" && typeof sa.private_key === "string") {
    const privateKeyPem = repairPem(sa.private_key);
    let parses = true;
    try {
      crypto.createPrivateKey(privateKeyPem);
    } catch {
      parses = false;
    }
    if (parses) {
      cfg = {
        packageName,
        clientEmail: sa.client_email.trim(),
        privateKeyPem,
        privateKeyId: typeof sa.private_key_id === "string" ? sa.private_key_id : null,
        tokenUri: typeof sa.token_uri === "string" && sa.token_uri ? sa.token_uri : DEFAULT_TOKEN_URI,
        rtdnToken: env.GOOGLE_PLAY_RTDN_TOKEN?.trim() || null,
      };
    }
  }
  configCache = { key, cfg };
  return cfg;
}

/**
 * What the running process holds, for /api/admin/preflight/google-play.
 * Discloses no secret: the key is reported as "does it parse", the RTDN
 * token as "set", and the service account's email (not a secret — it is
 * what gets invited in Play Console) is printed so it can be matched.
 */
export function describeGooglePlayEnv() {
  const env = process.env;
  const sa = parseServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT);
  let keyParses = false;
  if (sa && typeof sa.private_key === "string") {
    try {
      crypto.createPrivateKey(repairPem(sa.private_key));
      keyParses = true;
    } catch {
      keyParses = false;
    }
  }
  const missing: string[] = [];
  if (!env.GOOGLE_PLAY_PACKAGE_NAME?.trim()) missing.push("GOOGLE_PLAY_PACKAGE_NAME");
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT?.trim()) missing.push("GOOGLE_PLAY_SERVICE_ACCOUNT");
  const base = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return {
    configured: googlePlayConfig() !== null,
    missing,
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || null,
    serviceAccount: {
      present: !!env.GOOGLE_PLAY_SERVICE_ACCOUNT?.trim(),
      parses: !!sa,
      clientEmail: sa && typeof sa.client_email === "string" ? sa.client_email : null,
      keyParses,
    },
    notifications: {
      tokenSet: !!env.GOOGLE_PLAY_RTDN_TOKEN?.trim(),
      // The token itself is not printed; whoever registers the URL has it.
      pushEndpoint: base ? `${base}/api/billing/google/notifications?token=<GOOGLE_PLAY_RTDN_TOKEN>` : null,
    },
  };
}

// ------------------------------------------------------- access token ---

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url").replace(/=+$/, "");

let accessTokenCache: { token: string; expiresAt: number; email: string } | null = null;

/** The signed assertion a service account trades for an access token:
 *  RS256, `iss` the account, `aud` the token endpoint, one hour. */
export function serviceAccountAssertion(cfg: GooglePlayConfig, tokenUrl: string, now = Date.now()): string {
  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (cfg.privateKeyId) header.kid = cfg.privateKeyId;
  const iat = Math.floor(now / 1000);
  const claims = { iss: cfg.clientEmail, scope: SCOPE, aud: tokenUrl, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto.sign("sha256", Buffer.from(input), cfg.privateKeyPem);
  return `${input}.${b64url(sig)}`;
}

const tokenUrlFor = (cfg: GooglePlayConfig) => process.env.GOOGLE_OAUTH_TOKEN_URL?.trim() || cfg.tokenUri;
const apiBase = () => (process.env.GOOGLE_PLAY_API_URL?.trim() || DEFAULT_API).replace(/\/+$/, "");

export async function googleAccessToken(cfg: GooglePlayConfig, now = Date.now()): Promise<string> {
  if (accessTokenCache && accessTokenCache.email === cfg.clientEmail && accessTokenCache.expiresAt - 60_000 > now) {
    return accessTokenCache.token;
  }
  const url = tokenUrlFor(cfg);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: serviceAccountAssertion(cfg, url, now),
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the service account (${res.status}${body.error ? ` ${body.error}` : ""}).`);
  }
  accessTokenCache = {
    token: body.access_token,
    expiresAt: now + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    email: cfg.clientEmail,
  };
  return body.access_token;
}

// --------------------------------------------------- the subscription ---

/** The fields of a SubscriptionPurchaseV2 this adapter reads. */
export interface PlaySubscription {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  latestOrderId?: string;
  testPurchase?: Record<string, unknown>;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
}

export type PlayLookup =
  | { ok: true; sub: PlaySubscription }
  /** Google does not know the token, or it is not this app's. Final. */
  | { ok: false; kind: "not_found"; status: number }
  /** Google could not be asked, or refused the service account. Retryable. */
  | { ok: false; kind: "unavailable"; status: number | null; message: string };

const tokenPath = (cfg: GooglePlayConfig, purchaseToken: string) =>
  `${apiBase()}/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

export async function fetchPlaySubscription(cfg: GooglePlayConfig, purchaseToken: string): Promise<PlayLookup> {
  let token: string;
  try {
    token = await googleAccessToken(cfg);
  } catch (e) {
    return { ok: false, kind: "unavailable", status: null, message: (e as Error).message };
  }
  try {
    const res = await fetch(tokenPath(cfg, purchaseToken), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    // 400 is what Google answers a token that was never issued
    // ("Invalid Value"); 404/410 a token it no longer holds.
    if (res.status === 400 || res.status === 404 || res.status === 410) return { ok: false, kind: "not_found", status: res.status };
    if (!res.ok) return { ok: false, kind: "unavailable", status: res.status, message: `Play answered ${res.status}` };
    return { ok: true, sub: (await res.json()) as PlaySubscription };
  } catch (e) {
    return { ok: false, kind: "unavailable", status: null, message: (e as Error).message };
  }
}

export interface PlaySubscriptionFacts {
  providerRef: string;
  status: SubStatus;
  renewsAt: Date | null;
  willNotRenew: boolean;
  /** The token this one replaced (an upgrade, a downgrade, a resubscribe). */
  replaces: string | null;
}

export type PlayFactsResult =
  | { kind: "facts"; facts: PlaySubscriptionFacts }
  /** Paid by a method that has not cleared. Nothing is written or granted. */
  | { kind: "pending" }
  /** A state this adapter does not know. Nothing is written. */
  | { kind: "unknown"; state: string };

/** The latest expiry across the subscription's items, or null. */
function latestExpiry(sub: PlaySubscription): Date | null {
  let best: Date | null = null;
  for (const li of sub.lineItems ?? []) {
    const d = li.expiryTime ? new Date(li.expiryTime) : null;
    if (d && !Number.isNaN(d.getTime()) && (!best || d > best)) best = d;
  }
  return best;
}

/**
 * Google's subscription, in this app's vocabulary. Pure, so the whole
 * translation is under test.
 */
export function subscriptionFromGoogle(sub: PlaySubscription, purchaseToken: string, now = Date.now()): PlayFactsResult {
  const state = sub.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
  const renewsAt = latestExpiry(sub);
  const autoRenewOff = (sub.lineItems ?? []).some((li) => li.autoRenewingPlan?.autoRenewEnabled === false);
  let status: SubStatus;
  let willNotRenew = autoRenewOff;
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      status = "active";
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      status = "grace";
      break;
    case "SUBSCRIPTION_STATE_CANCELED":
      // Cancelled is "will not renew": paid-for time runs out first.
      status = renewsAt && renewsAt.getTime() > now ? "active" : "expired";
      willNotRenew = true;
      break;
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
    case "SUBSCRIPTION_STATE_EXPIRED":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      status = "expired";
      break;
    case "SUBSCRIPTION_STATE_PENDING":
      return { kind: "pending" };
    default:
      return { kind: "unknown", state };
  }
  return {
    kind: "facts",
    facts: {
      providerRef: purchaseToken,
      status,
      renewsAt,
      willNotRenew,
      replaces: sub.linkedPurchaseToken && sub.linkedPurchaseToken !== purchaseToken ? sub.linkedPurchaseToken : null,
    },
  };
}

/** Whether this server should acknowledge the purchase now. */
export function needsAcknowledge(sub: PlaySubscription): boolean {
  if (sub.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING") return false;
  return (
    sub.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" ||
    sub.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    sub.subscriptionState === "SUBSCRIPTION_STATE_CANCELED"
  );
}

const productIdOf = (sub: PlaySubscription): string | null => sub.lineItems?.find((li) => li.productId)?.productId ?? null;

/** Best effort. A failure is logged and left for the phone's own
 *  acknowledge, or the next notification, to cover. */
export async function acknowledgePlaySubscription(cfg: GooglePlayConfig, purchaseToken: string, sub: PlaySubscription): Promise<boolean> {
  if (!needsAcknowledge(sub)) return false;
  const productId = productIdOf(sub);
  if (!productId) return false;
  try {
    const token = await googleAccessToken(cfg);
    const res = await fetch(
      `${apiBase()}/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) {
      console.error(`[billing:google] acknowledge refused (${res.status})`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[billing:google] acknowledge failed:", (e as Error).message);
    return false;
  }
}

/**
 * Cancel a subscription now that its account is being deleted: renewal
 * stops, and the time already paid for runs out on Google's side (there is
 * no account left to use it, but Google's refund rules are Google's).
 * Throws when Google could not be asked or refused; the caller decides
 * what that means (billing/cancel.ts reports it as the person's to do).
 */
export async function cancelPlaySubscription(cfg: GooglePlayConfig, purchaseToken: string, productId: string): Promise<void> {
  const token = await googleAccessToken(cfg);
  const res = await fetch(
    `${apiBase()}/androidpublisher/v3/applications/${encodeURIComponent(cfg.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    }
  );
  // Already ended at Google: nothing left to stop.
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) throw new Error(`Google Play refused the cancellation (${res.status}).`);
}

/** The product id stored with a row's raw Google answer, for a cancel. */
export function productIdOfStored(raw: unknown): string | null {
  const sub = (raw as { subscription?: PlaySubscription } | null)?.subscription;
  return sub ? productIdOf(sub) : null;
}

// ------------------------------------------------------------- the row ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account a stored Play subscription belongs to, if we have one. */
export async function storedOwnerOfPlaySubscription(purchaseToken: string): Promise<string | null> {
  const rows = await getDb()
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, GOOGLE_PLAY_PROVIDER), eq(subscriptions.provider_ref, purchaseToken)));
  return rows[0]?.userId ?? null;
}

/** The account id the purchase itself names, when it names a real one. */
export async function namedOwnerOfPlaySubscription(sub: PlaySubscription): Promise<string | null> {
  const id = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId?.trim().toLowerCase();
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id));
  return rows[0]?.id ?? null;
}

/**
 * Which account a subscription belongs to: the one the purchase names,
 * then the row already stored for this token, then the row for the token
 * it replaced (a plan change made on a phone that set no account id).
 */
export async function userIdForPlaySubscription(sub: PlaySubscription, purchaseToken: string): Promise<string | null> {
  const named = await namedOwnerOfPlaySubscription(sub);
  if (named) return named;
  const stored = await storedOwnerOfPlaySubscription(purchaseToken);
  if (stored) return stored;
  const linked = sub.linkedPurchaseToken;
  return linked && linked !== purchaseToken ? storedOwnerOfPlaySubscription(linked) : null;
}

/**
 * Write the row for this token, and close the row of the token it
 * replaced (same account only). Keyed on (provider, provider_ref), so the
 * verify call and a notification converge however often either arrives.
 */
export async function upsertGoogleSubscription(params: {
  userId: string;
  facts: PlaySubscriptionFacts;
  sub: PlaySubscription;
  notificationType?: number | string | null;
}): Promise<void> {
  const { userId, facts } = params;
  const values = {
    userId,
    provider: GOOGLE_PLAY_PROVIDER,
    provider_ref: facts.providerRef,
    status: facts.status,
    renewsAt: facts.renewsAt,
    willNotRenew: facts.willNotRenew,
    raw: { subscription: params.sub, notificationType: params.notificationType ?? null } as Record<string, unknown>,
    updatedAt: new Date(),
  };
  await getDb().transaction(async (tx) => {
    await tx
      .insert(subscriptions)
      .values({ id: crypto.randomUUID(), ...values })
      .onConflictDoUpdate({ target: [subscriptions.provider, subscriptions.provider_ref], set: values });
    if (facts.replaces) {
      await tx
        .update(subscriptions)
        .set({ status: "expired", willNotRenew: true, updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.provider, GOOGLE_PLAY_PROVIDER),
            eq(subscriptions.provider_ref, facts.replaces),
            eq(subscriptions.userId, userId)
          )
        );
    }
  });
}

// ----------------------------------------------------- notifications ---

/** What a Real-Time Developer Notification names, decoded from the Pub/Sub
 *  push envelope; null when it is not one. */
export interface PlayNotification {
  packageName: string | null;
  /** The token to look up, for a subscription or a voided (refunded)
   *  purchase; null for a test notification or anything else. */
  purchaseToken: string | null;
  /** Google's numeric subscription notification type, or 'voided'/'test'. */
  type: number | "voided" | "test" | "other";
}

export function decodePlayNotification(body: unknown): PlayNotification | null {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== "string" || !data) return null;
  let msg: {
    packageName?: unknown;
    subscriptionNotification?: { notificationType?: unknown; purchaseToken?: unknown };
    voidedPurchaseNotification?: { purchaseToken?: unknown; productType?: unknown };
    testNotification?: unknown;
  };
  try {
    msg = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const packageName = typeof msg.packageName === "string" ? msg.packageName : null;
  if (msg.subscriptionNotification) {
    const t = msg.subscriptionNotification.purchaseToken;
    const n = msg.subscriptionNotification.notificationType;
    return { packageName, purchaseToken: typeof t === "string" && t ? t : null, type: typeof n === "number" ? n : "other" };
  }
  if (msg.voidedPurchaseNotification) {
    // productType 1 is a subscription; a one-time product is not this app's.
    const t = msg.voidedPurchaseNotification.purchaseToken;
    const isSub = msg.voidedPurchaseNotification.productType === 1;
    return { packageName, purchaseToken: isSub && typeof t === "string" && t ? t : null, type: "voided" };
  }
  if (msg.testNotification) return { packageName, purchaseToken: null, type: "test" };
  return { packageName, purchaseToken: null, type: "other" };
}

/** Constant-time comparison of the notifications URL's token. */
export function rtdnTokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
