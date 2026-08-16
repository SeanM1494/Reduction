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
import { revokeSession, SESSION_COOKIE } from "../lib/sessions";

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
