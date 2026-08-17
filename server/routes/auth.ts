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

import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../shared/schema";
import { clearCookie, serializeCookie } from "../lib/cookies";
import {
  consumeAuthState,
  createAuthState,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "../lib/sessions";
import { buildAuthUrl, exchangeCode, googleConfig, newCodeVerifier } from "../lib/google";
import { userIdForIdentity } from "../lib/accounts";
import { claimAnonymousLibrary } from "../lib/claim";
import { claimTrialRecipe, readTrialId } from "../lib/trial";

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
    return res.json({
      user: { id: row.id, displayName: row.displayName, email: row.email },
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
  return res.json({ providers: { google: !!googleConfig() } });
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

  // The visitor declined the consent screen, or Google refused outright.
  if (typeof req.query.error === "string") {
    return res.redirect(appRedirect({ auth_error: "declined" }));
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code || !state) return res.redirect(appRedirect({ auth_error: "bad_callback" }));

  try {
    // Single-use: the read is a DELETE ... RETURNING, so a replayed state
    // finds nothing and cannot re-trigger the extraction its pending URL
    // would have started.
    const pending = await consumeAuthState(state, "google");
    if (!pending || !pending.pkceVerifier) {
      return res.redirect(appRedirect({ auth_error: "expired" }));
    }

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
    return res.redirect(appRedirect({ auth_error: "exchange_failed" }));
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
