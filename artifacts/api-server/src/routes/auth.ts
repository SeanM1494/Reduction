/**
 * server/routes/auth.ts — session-facing auth endpoints.
 *
 *   GET  /api/auth/me      who is signed in, if anyone
 *   POST /api/auth/logout  revoke this session and clear the cookie
 *
 * The provider handshakes (Google, then Apple) mount here too, in the next
 * step. This file is deliberately the only place that writes the session
 * cookie, so its flags live in exactly one spot.
 */

import express, { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { entitlementFor } from "../lib/billing/entitlement";
import { users } from "@workspace/db";
import { clearCookie, serializeCookie } from "../lib/cookies";
import {
  consumeAuthState,
  consumeMobileHandoff,
  createAuthState,
  createMobileHandoff,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "../lib/sessions";
import { buildAuthUrl, exchangeCode, googleConfig, newCodeVerifier } from "../lib/google";
import {
  APPLE_CALLBACK_PATH,
  appleConfig,
  buildAuthUrl as buildAppleAuthUrl,
  exchangeCode as exchangeAppleCode,
  parseUserField,
} from "../lib/apple";
import { userIdForIdentity } from "../lib/accounts";
import { claimAnonymousLibrary } from "../lib/claim";
import { claimTrialRecipe, readTrialId } from "../lib/trial";
import { BUILD_COMMIT } from "../lib/buildInfo";

export const authRouter = Router();

const isProd = process.env.NODE_ENV === "production";

/** Ninety days, matching SESSION_TTL_MS in lib/sessions.ts. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/** The one place the session cookie is written. Secure only in production —
 *  there is no https to be secure over in local development, and a Secure
 *  cookie there would simply never be stored. */
export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
      secure: isProd,
    })
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, { secure: isProd }));
}

/**
 * The client's source of truth for signed-in state. Replaces the old
 * "library.length === 0 means logged out" guess in client/src/App.tsx, which
 * could only ever be an approximation.
 */
authRouter.get("/me", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) return res.json({ user: null });

  try {
    const db = getDb();
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    if (!row) {
      // The session outlived its user — a deleted account, most likely.
      // Clear the cookie rather than leaving the browser holding one that
      // will never resolve again.
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    /**
     * Entitlement rides along with the session, so the client can render the
     * wall BEFORE someone types a search rather than after they submit one.
     * The server gate is the enforcement; this is what stops the UI inviting
     * work it is about to refuse.
     */
    let entitlement = null;
    try {
      entitlement = await entitlementFor(userId);
    } catch (e) {
      // Never fail /me over billing: a missing entitlement makes the client
      // behave as it did before the paywall existed, which is the safe
      // direction for a read the whole app boots from.
      console.error("[auth:me] entitlement unavailable:", (e as Error).message);
    }

    return res.json({
      user: { id: row.id, displayName: row.displayName, email: row.email },
      entitlement,
    });
  } catch (e) {
    console.error("[auth:me]", e);
    return res.status(500).json({ error: "Could not load your account." });
  }
});

/**
 * Signing out is a real revocation, not just a forgotten cookie: the row goes
 * from the sessions table, so the token is dead everywhere immediately. That
 * matters on a shared machine, which is the case sign-out exists for.
 *
 * The cookie is cleared even if the revoke fails — a browser still holding a
 * token it believes is valid is the worse outcome of the two.
 */
authRouter.post("/logout", async (req: Request, res: Response) => {
  const token = req.sessionToken;
  try {
    if (token) await revokeSession(token);
  } catch (e) {
    console.error("[auth:logout]", e);
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

// ----------------------------------------------------------------- Google --

/**
 * Which providers are actually configured. The client asks first so it can
 * render only the buttons that work — a sign-in button that 503s is worse
 * than no button at all.
 */
authRouter.get("/providers", (_req: Request, res: Response) => {
  return res.json({ providers: { google: !!googleConfig(), apple: !!appleConfig() } });
});

/**
 * Where the SPA is sent when a handshake ends. Always a path on this origin,
 * never anything derived from the request, so this can't become an open
 * redirect.
 */
function appRedirect(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  return query ? `/?${query}` : "/";
}

/** The redirect a standalone/App Store build actually owns — see app.json's
 *  `scheme`. Always the fallback, and the ONLY option ever used in
 *  production (see isAllowedMobileRedirect below). */
const DEFAULT_MOBILE_REDIRECT = "reduction-mobile://auth";

/**
 * Whether a client-supplied `redirect_uri` may be used for a mobile OAuth
 * handshake, instead of the app's own fixed `reduction-mobile://auth`.
 *
 * This exists because Expo Go does not own the app's custom scheme in
 * development — only a standalone/EAS build does. Inside Expo Go,
 * `Linking.createURL('auth')` returns a link back to *that* Expo Go
 * session's own host (an `exp://` or `exps://` URL under this Repl's dev
 * domain), which is different every workspace and impossible to allowlist
 * as a fixed string. So instead of trusting any redirect a caller names,
 * this only ever accepts:
 *   - the app's real scheme, exactly, in any environment; or
 *   - an `exp:`/`exps:` URL whose host ends in this Repl's own dev domain,
 *     and ONLY outside production.
 * A production server never honors a client-supplied redirect at all — see
 * the call sites below, which pass `undefined` in production regardless of
 * what the request asked for. That keeps the one real trust decision
 * (accepting a redirect the client names) scoped to development, where the
 * worst case is redirecting a handoff code to another Expo Go session on the
 * same dev domain, not to an attacker's own app in production.
 */
export function isAllowedMobileRedirect(raw: string): boolean {
  if (raw === DEFAULT_MOBILE_REDIRECT) return true;
  // Read at call time, not the module-level isProd const: the production
  // refusal below is a security property, and a property a test cannot reach
  // (the const is frozen at import) is a property that can regress silently.
  if (process.env.NODE_ENV === "production") return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "exp:" && u.protocol !== "exps:") return false;
    /**
     * TWO dev domains, not one, and the second is the bug this fixed. The
     * mobile artifact's dev script serves the Expo packager through
     * $REPLIT_EXPO_DEV_DOMAIN (EXPO_PACKAGER_PROXY_URL) while pointing API
     * calls at $REPLIT_DEV_DOMAIN — and Linking.createURL derives from the
     * PACKAGER, so Expo Go's redirect arrives as exp://$REPLIT_EXPO_DEV_DOMAIN/--/auth.
     * Checking only REPLIT_DEV_DOMAIN rejected every dev sign-in, and the
     * silent fallback then redirected Safari to reduction-mobile:// — a
     * scheme Expo Go does not own, surfacing as "Safari cannot open the page
     * because the address is invalid" after the provider screen.
     */
    const allowedDomains = [
      process.env.REPLIT_DEV_DOMAIN,
      process.env.REPLIT_EXPO_DEV_DOMAIN,
    ].filter((d): d is string => !!d);
    return allowedDomains.some(
      (d) => u.hostname === d || u.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

/** The caller's redirect if it passes validation, else the app's own fixed
 *  scheme — never nothing, so a rejected/missing redirect_uri degrades to
 *  the always-safe default rather than failing the handshake outright. */
export function resolveMobileRedirect(raw: unknown): string {
  if (typeof raw === "string" && raw.length <= 2000 && isAllowedMobileRedirect(raw)) {
    return raw;
  }
  // Say so when a real value was rejected. The fallback is the right failure
  // mode (never break the handshake outright), but silent was how a domain
  // mismatch spent a debugging session disguised as a malformed URL.
  if (typeof raw === "string" && raw) {
    console.warn(
      `[auth:mobile] redirect_uri rejected, using ${DEFAULT_MOBILE_REDIRECT}: ${raw.slice(0, 120)}`
    );
  }
  return DEFAULT_MOBILE_REDIRECT;
}

/**
 * Where the mobile app is sent when its handshake ends — a deep link, not a
 * path on this origin. `base` is whatever this attempt's auth_state row
 * recorded (see resolveMobileRedirect at the /mobile/*\/start routes): the
 * app's own `reduction-mobile` scheme in a standalone/App Store build, or a
 * validated Expo Go dev-session link in development. Either way this is a
 * deep link the OS delivers directly to the app, not a URL Google/Apple ever
 * see — they only ever see this server's own callback (GOOGLE_CALLBACK_PATH
 * / APPLE_CALLBACK_PATH), so nothing about their console configuration
 * changes for the mobile handshake to exist.
 */
/** One line per minted handoff, so a deployment log shows which server did
 *  the callback and where it sent the phone — never the code itself. */
function logMobileHandoff(provider: string, userId: string, redirectUri: string | null | undefined): void {
  let target = DEFAULT_MOBILE_REDIRECT;
  try {
    const u = new URL(redirectUri ?? DEFAULT_MOBILE_REDIRECT);
    target = `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    /* keep the default */
  }
  console.log(
    `[auth:mobile] ${provider} callback on ${BUILD_COMMIT}: handoff minted for user ${userId.slice(0, 8)}… → ${target}`
  );
}

function mobileRedirect(
  params: Record<string, string | null | undefined>,
  base: string = DEFAULT_MOBILE_REDIRECT
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${query ? `${sep}${query}` : ""}`;
}

/**
 * One-time codes standing in for a sign-in in a deep link.
 *
 * The session token itself is never put in a URL: a deep link can end up in
 * OS-level logs or a screenshot, and a session token is a bearer credential
 * for as long as it lives (90 days — see SESSION_TTL_MS). So the callback
 * hands the app a short-lived, single-use code instead, and the app trades it
 * for a real token over a POST body (see /mobile/exchange below). The code
 * lives in the DATABASE — see createMobileHandoff in lib/sessions.ts for the
 * Autoscale failure that the in-memory version of this produced.
 */

/** A recipe URL is the only thing we will carry through a handshake, and only
 *  if it plausibly is one. Anything else is dropped rather than rejected —
 *  a malformed pending URL should not cost someone their sign-in. */
function safePendingUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

authRouter.get("/google/start", async (req: Request, res: Response) => {
  const cfg = googleConfig();
  if (!cfg) {
    return res
      .status(503)
      .json({ error: "Google sign-in is not configured on this server." });
  }

  try {
    const codeVerifier = newCodeVerifier();
    const state = await createAuthState({
      provider: "google",
      pkceVerifier: codeVerifier,
      // Rides in the database rather than the browser, so it survives a
      // provider that lands in a new tab and a sign-up finished on another
      // device — see the auth_states comment in shared/schema.ts.
      pendingUrl: safePendingUrl(req.query.pendingUrl),
      // Whatever this browser already extracted for free follows it into the
      // account it is about to make.
      trialId: readTrialId(req),
    });
    return res.redirect(buildAuthUrl(cfg, { state, codeVerifier }));
  } catch (e) {
    console.error("[auth:google:start]", e);
    return res.redirect(appRedirect({ auth_error: "start_failed" }));
  }
});

/**
 * Errors here redirect into the app with a code rather than rendering JSON:
 * this URL is reached by a top-level browser navigation, so whatever it
 * returns is what the visitor is left looking at.
 */
authRouter.get("/google/callback", async (req: Request, res: Response) => {
  const cfg = googleConfig();
  if (!cfg) return res.redirect(appRedirect({ auth_error: "not_configured" }));

  const declined = typeof req.query.error === "string";
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  // No state at all means there is nothing to consume and no way to tell
  // which flavor of handshake this was — the web fallback is the safest
  // guess for a callback this malformed.
  if (!state) {
    return res.redirect(appRedirect({ auth_error: declined ? "declined" : "bad_callback" }));
  }

  // Single-use: the read is a DELETE ... RETURNING, so a replayed state finds
  // nothing and cannot re-trigger the extraction its pending URL would have
  // started. Tried as "google" (the web start) first, then "google-mobile"
  // (see /mobile/google/start below) — the two never collide, since state is
  // 32 random bytes generated per attempt, so this only ever costs one extra
  // lookup on the mobile path.
  let pending = await consumeAuthState(state, "google");
  let isMobile = false;
  if (!pending) {
    pending = await consumeAuthState(state, "google-mobile");
    isMobile = pending !== null;
  }
  const redirect = (params: Record<string, string | null | undefined>) =>
    res.redirect(
      isMobile ? mobileRedirect(params, pending?.redirectUri ?? undefined) : appRedirect(params)
    );

  // The visitor declined the consent screen, or Google refused outright.
  if (declined) return redirect({ auth_error: "declined" });
  if (!code) return redirect({ auth_error: "bad_callback" });
  if (!pending || !pending.pkceVerifier) return redirect({ auth_error: "expired" });

  try {
    const identity = await exchangeCode(cfg, {
      code,
      codeVerifier: pending.pkceVerifier,
      state,
    });

    const userId = await userIdForIdentity({
      provider: "google",
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
    });

    // The mobile app has no cookie jar of its own — it trades a one-time
    // code for a token over POST /mobile/exchange instead, and the session
    // is minted THERE, not here, so nothing exists for a handoff nobody
    // redeems. No trial to claim here: the mobile handshake never carries one
    // (its start route passes trialId: null), since the free extraction it
    // would refer to happened, if at all, in the app's own fetch calls, not
    // this browser.
    if (isMobile) {
      const handoffCode = await createMobileHandoff(userId);
      logMobileHandoff("google", userId, pending.redirectUri);
      return res.redirect(mobileRedirect({ code: handoffCode }, pending.redirectUri ?? undefined));
    }

    const { token } = await createSession(userId);
    setSessionCookie(res, token);

    /**
     * The trial recipe becomes theirs here, before they land. Someone who
     * extracted a recipe, looked at its diagram and signed up to keep it must
     * find it waiting — that is the whole promise of the free extraction.
     * A failure is logged and left: the trial row is untouched, so the
     * client's claim call retries it on the next load.
     */
    const trialId = pending.trialId ?? readTrialId(req);
    if (trialId) {
      try {
        await claimTrialRecipe(userId, trialId);
      } catch (e) {
        console.error("[auth:trial-claim]", e);
      }
    }

    // signed_in tells the client to run the claim; see the claim endpoint for
    // what happens when that call fails.
    return res.redirect(
      appRedirect({ signed_in: "1", pending: pending.pendingUrl ?? undefined })
    );
  } catch (e) {
    console.error("[auth:google:callback]", e);
    return redirect({ auth_error: "exchange_failed" });
  }
});

/**
 * Mirrors /google/start for the mobile app: same authorize URL, same
 * registered redirect_uri (GOOGLE_CALLBACK_PATH — nothing about the Google
 * Cloud console console changes), only the auth_state's provider tag differs
 * so /google/callback above can tell the two attempts apart when Google
 * redirects back.
 */
authRouter.get("/mobile/google/start", async (req: Request, res: Response) => {
  const cfg = googleConfig();
  if (!cfg) {
    return res
      .status(503)
      .json({ error: "Google sign-in is not configured on this server." });
  }

  const redirectUri = resolveMobileRedirect(req.query.redirect_uri);
  try {
    const codeVerifier = newCodeVerifier();
    const state = await createAuthState({
      provider: "google-mobile",
      pkceVerifier: codeVerifier,
      pendingUrl: null,
      trialId: null,
      redirectUri,
    });
    return res.redirect(buildAuthUrl(cfg, { state, codeVerifier }));
  } catch (e) {
    console.error("[auth:google:start:mobile]", e);
    return res.redirect(mobileRedirect({ auth_error: "start_failed" }, redirectUri));
  }
});

// ------------------------------------------------------------------ apple --

authRouter.get("/apple/start", async (req: Request, res: Response) => {
  const cfg = appleConfig();
  if (!cfg) {
    return res
      .status(503)
      .json({ error: "Apple sign-in is not configured on this server." });
  }

  try {
    /**
     * No PKCE verifier. Apple's web flow does not support PKCE — the client
     * secret JWT is what authenticates this app at the token endpoint, and
     * the state/nonce pair is what binds the callback to this attempt. The
     * column stays null rather than gaining a fake value, so a glance at
     * auth_states says which provider a row came from.
     */
    const state = await createAuthState({
      provider: "apple",
      pkceVerifier: null,
      pendingUrl: safePendingUrl(req.query.pendingUrl),
      trialId: readTrialId(req),
    });
    return res.redirect(buildAppleAuthUrl(cfg, { state }));
  } catch (e) {
    console.error("[auth:apple:start]", e);
    return res.redirect(appRedirect({ auth_error: "start_failed" }));
  }
});

/**
 * A POST, not a GET, and the one route in this app with a urlencoded body.
 *
 * Apple requires `response_mode=form_post` whenever the name or email scope
 * is requested, so it POSTs a urlencoded form to this URL. express.json() —
 * mounted globally in server/index.ts — does not touch that content type, so
 * the parser is mounted HERE and nowhere else: a global urlencoded parser
 * would start accepting form bodies on every other route in the app, which is
 * a CSRF surface nothing else needs. Same reasoning as the Stripe webhook
 * sitting before express.json().
 *
 * The 1kb cap is generous for {code, state, user} and small enough that this
 * cannot be used to make the process parse something large.
 */
authRouter.post(
  "/apple/callback",
  express.urlencoded({ extended: false, limit: "1kb" }),
  async (req: Request, res: Response) => {
    const cfg = appleConfig();
    if (!cfg) return res.redirect(appRedirect({ auth_error: "not_configured" }));

    const body = (req.body ?? {}) as Record<string, unknown>;

    // The visitor cancelled at Apple's sheet, or Apple refused outright.
    const declined = typeof body.error === "string";
    const code = typeof body.code === "string" ? body.code : null;
    const state = typeof body.state === "string" ? body.state : null;

    if (!state) {
      return res.redirect(appRedirect({ auth_error: declined ? "declined" : "bad_callback" }));
    }

    // Tried as "apple" (the web start) first, then "apple-mobile" (see
    // /mobile/apple/start below) — see the matching comment on the Google
    // callback above for why the two never collide.
    let pending = await consumeAuthState(state, "apple");
    let isMobile = false;
    if (!pending) {
      pending = await consumeAuthState(state, "apple-mobile");
      isMobile = pending !== null;
    }
    const redirect = (params: Record<string, string | null | undefined>) =>
      res.redirect(
        isMobile ? mobileRedirect(params, pending?.redirectUri ?? undefined) : appRedirect(params)
      );

    if (declined) return redirect({ auth_error: "declined" });
    if (!code) return redirect({ auth_error: "bad_callback" });
    if (!pending) return redirect({ auth_error: "expired" });

    try {
      const identity = await exchangeAppleCode(cfg, { code, state });

      /**
       * THE NAME ARRIVES HERE, ONCE, EVER.
       *
       * Apple puts it in the form body on the FIRST authorization only, never
       * in the id_token, and never again for this Apple ID and Services ID —
       * re-signing in does not bring it back unless the user first removes
       * the app under Settings -> Apple ID -> Sign in with Apple. So this is
       * the single opportunity to capture it, and dropping it is permanent.
       *
       * On every later sign-in this is null, and userIdForIdentity only
       * patches displayName when it has one — so a returning user keeps the
       * name captured the first time rather than having it overwritten with
       * nothing.
       */
      const displayName = parseUserField(body.user);

      const userId = await userIdForIdentity({
        provider: "apple",
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName,
      });

      if (isMobile) {
        const handoffCode = await createMobileHandoff(userId);
        logMobileHandoff("apple", userId, pending.redirectUri);
        return res.redirect(
          mobileRedirect({ code: handoffCode }, pending.redirectUri ?? undefined)
        );
      }

      const { token } = await createSession(userId);
      setSessionCookie(res, token);

      const trialId = pending.trialId ?? readTrialId(req);
      if (trialId) {
        try {
          await claimTrialRecipe(userId, trialId);
        } catch (e) {
          console.error("[auth:trial-claim]", e);
        }
      }

      return res.redirect(
        appRedirect({ signed_in: "1", pending: pending.pendingUrl ?? undefined })
      );
    } catch (e) {
      console.error("[auth:apple:callback]", e);
      return redirect({ auth_error: "exchange_failed" });
    }
  }
);

/** Mirrors /apple/start for the mobile app — see the comment on
 *  /mobile/google/start above for why nothing about the Apple Services ID
 *  configuration needs to change for this to exist. */
authRouter.get("/mobile/apple/start", async (req: Request, res: Response) => {
  const cfg = appleConfig();
  if (!cfg) {
    return res
      .status(503)
      .json({ error: "Apple sign-in is not configured on this server." });
  }

  const redirectUri = resolveMobileRedirect(req.query.redirect_uri);
  try {
    const state = await createAuthState({
      provider: "apple-mobile",
      pkceVerifier: null,
      pendingUrl: null,
      trialId: null,
      redirectUri,
    });
    return res.redirect(buildAppleAuthUrl(cfg, { state }));
  } catch (e) {
    console.error("[auth:apple:start:mobile]", e);
    return res.redirect(mobileRedirect({ auth_error: "start_failed" }, redirectUri));
  }
});

/**
 * The mobile app's other half of the handoff: trades the one-time code from
 * the deep link (?code=...) for the real session token, which it then sends
 * as `Authorization: Bearer <token>` on every request (see
 * middleware/session.ts). Anyone who has the code can redeem it — that is
 * fine, because it lived for at most five minutes in a redirect the OS
 * delivered directly to this one app.
 */
authRouter.post("/mobile/exchange", async (req: Request, res: Response) => {
  const code = typeof req.body?.code === "string" ? req.body.code : null;
  if (!code) return res.status(400).json({ error: "Missing code." });

  try {
    const handoff = await consumeMobileHandoff(code);
    if (!handoff) {
      // The one line to look for when a phone reports "expired". A code that
      // was minted seconds ago by a callback on ANOTHER server (Google calls
      // back to PUBLIC_BASE_URL, which is the deployment, while the app talks
      // to whichever server EXPO_PUBLIC_DOMAIN names) is only visible here if
      // that server also runs the database-backed handoff — check both
      // /api/health commits before suspecting the clock.
      console.warn(`[auth:mobile] exchange refused on ${BUILD_COMMIT}: no live handoff for that code`);
      return res.status(400).json({ error: "That sign-in attempt expired. Please try again." });
    }
    // Minted here, on redemption — see createMobileHandoff in lib/sessions.ts.
    const { token } = await createSession(handoff.userId);
    console.log(`[auth:mobile] exchange ok on ${BUILD_COMMIT}: session minted for user ${handoff.userId.slice(0, 8)}…`);
    return res.json({ token });
  } catch (e) {
    console.error("[auth:mobile:exchange]", (e as Error).message);
    return res.status(500).json({ error: "Could not complete sign-in." });
  }
});

// ------------------------------------------------------------------ claim --

/**
 * Hands the anonymous library under X-Owner-Key to the signed-in account.
 *
 * Called by the client on every load where a session exists and the key is
 * not yet marked claimed — not only just after signing in. That is what makes
 * a failed claim heal by itself, and what merges a second device's rows on a
 * later login. It is idempotent: a repeat call moves nothing and says so.
 *
 * The client marks the key claimed only when `remaining` is 0, and never
 * deletes it. See the long comment in server/lib/claim.ts for why that key is
 * the recovery path rather than litter.
 */
authRouter.post("/claim", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const ownerKey = req.header("X-Owner-Key");
  if (!ownerKey || ownerKey.length < 8 || ownerKey.length > 200) {
    return res.status(400).json({ error: "Missing or invalid X-Owner-Key header." });
  }

  try {
    const result = await claimAnonymousLibrary(userId, ownerKey);
    return res.json(result);
  } catch (e) {
    // Nothing moved — the transaction rolled back — so the honest response is
    // a failure the client will retry, not a partial success.
    console.error("[auth:claim]", e);
    return res
      .status(500)
      .json({ error: "Could not move your saved recipes into your account." });
  }
});
