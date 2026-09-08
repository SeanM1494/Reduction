/**
 * server/lib/sessions.ts — session lifecycle.
 *
 * A session token is 32 random bytes handed to the browser in an httpOnly
 * cookie. The database stores only its SHA-256, so a leak of the sessions
 * table does not hand anyone a working session — the same reason password
 * hashes exist, applied to the thing that actually grants access.
 *
 * Expiry is enforced twice, deliberately:
 *   - on read, so an expired row is never honoured no matter what else is
 *     true, and is deleted the moment it is seen
 *   - by a periodic sweep, so rows nobody reads again do not accumulate
 * A created_at column that nothing ever acts on is not an expiry policy.
 */

import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, authStates } from "../../shared/schema";

export const SESSION_COOKIE = "rd_session";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
/** How stale last_seen_at may get before a read bothers to update it. Without
 *  this every request would write, for a column only used to spot idle
 *  sessions. */
const TOUCH_AFTER_MS = 1000 * 60 * 60 * 24;
const SWEEP_EVERY_MS = 1000 * 60 * 60;

/** OAuth handshakes are seconds long in practice; ten minutes is generous. */
export const AUTH_STATE_TTL_MS = 1000 * 60 * 10;

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface SessionRecord {
  userId: string;
  expiresAt: Date;
}

/** Creates a session and returns the raw token — the only moment it exists
 *  outside the browser. */
export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const db = getDb();
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    idHash: hashToken(token),
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolves a token to its session, or null. An expired row is deleted on the
 * way past rather than merely ignored, so the natural traffic of people
 * returning with stale cookies does most of the cleanup.
 */
export async function resolveSession(token: string): Promise<SessionRecord | null> {
  const db = getDb();
  const idHash = hashToken(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.idHash, idHash));
  if (!row) return null;

  const expiresAt = new Date(row.expiresAt);
  if (expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.idHash, idHash));
    return null;
  }

  const lastSeen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (Date.now() - lastSeen > TOUCH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.idHash, idHash));
  }

  return { userId: row.userId, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(token)));
}

/** Every session for a user — what "sign out everywhere" will call. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ----------------------------------------------------------------- states --

export async function createAuthState(input: {
  provider: string;
  pkceVerifier?: string | null;
  pendingUrl?: string | null;
  /** The browser's free-extraction trial, so the recipe it already produced
   *  lands in the account being created — and survives finishing sign-up in
   *  another tab, which a cookie alone would not. */
  trialId?: string | null;
}): Promise<string> {
  const db = getDb();
  const state = newToken();
  await db.insert(authStates).values({
    state,
    provider: input.provider,
    pkceVerifier: input.pkceVerifier ?? null,
    pendingUrl: input.pendingUrl ?? null,
    trialId: input.trialId ?? null,
    expiresAt: new Date(Date.now() + AUTH_STATE_TTL_MS),
  });
  return state;
}

/**
 * Reads and destroys an auth state in one step.
 *
 * The delete is the read — `DELETE ... RETURNING` — so a state can be spent
 * exactly once even if two callbacks race. A replayed state finds nothing and
 * cannot re-trigger the extraction its pending URL would have started. An
 * expired row is likewise consumed and reported as a miss.
 */
export async function consumeAuthState(
  state: string,
  provider: string
): Promise<{
  pkceVerifier: string | null;
  pendingUrl: string | null;
  trialId: string | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .delete(authStates)
    .where(and(eq(authStates.state, state), eq(authStates.provider, provider)))
    .returning();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return {
    pkceVerifier: row.pkceVerifier,
    pendingUrl: row.pendingUrl,
    trialId: row.trialId,
  };
}

// ------------------------------------------------------------------ sweep --

/** Deletes everything already past its expiry. Safe to call at any time. */
export async function sweepExpired(): Promise<{ sessions: number; states: number }> {
  const db = getDb();
  const now = new Date();
  const deadSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ idHash: sessions.idHash });
  const deadStates = await db
    .delete(authStates)
    .where(lt(authStates.expiresAt, now))
    .returning({ state: authStates.state });
  return { sessions: deadSessions.length, states: deadStates.length };
}

/**
 * Starts the hourly sweep and runs one pass now. Never throws and never
 * blocks startup: a missing database already fails loudly on every real
 * route, and expired rows are refused on read regardless of whether this ran.
 */
export function startSessionSweep(): () => void {
  const pass = async () => {
    try {
      const { sessions: s, states: a } = await sweepExpired();
      if (s || a) console.log(`[sweep] removed ${s} session(s), ${a} auth state(s)`);
    } catch (e) {
      console.error("[sweep] skipped:", (e as Error).message);
    }
  };
  void pass();
  const timer = setInterval(pass, SWEEP_EVERY_MS);
  // Do not hold the process open on this alone — matters for tests and for a
  // clean shutdown.
  timer.unref?.();
  return () => clearInterval(timer);
}
