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
import { sessions, authStates } from "@workspace/db";

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
  /** Mobile only: the caller's own validated deep link (see
   *  isAllowedMobileRedirect in routes/auth.ts). Never set for a web state. */
  redirectUri?: string | null;
}): Promise<string> {
  const db = getDb();
  const state = newToken();
  await db.insert(authStates).values({
    state,
    provider: input.provider,
    pkceVerifier: input.pkceVerifier ?? null,
    pendingUrl: input.pendingUrl ?? null,
    trialId: input.trialId ?? null,
    redirectUri: input.redirectUri ?? null,
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
  redirectUri: string | null;
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
    redirectUri: row.redirectUri,
  };
}

// ---------------------------------------------------------- mobile handoff --

/**
 * One-time codes standing in for a sign-in in a deep link (the mobile app's
 * OAuth handshake — see routes/auth.ts, /mobile/exchange).
 *
 * IN THE DATABASE, NOT IN PROCESS MEMORY, and that is the whole point. The
 * first version kept these in a Map, reasoning that a five-minute window is
 * gone long before a redeploy matters. It missed that the deployment is
 * Autoscale: the callback (a browser GET that mints the code) and the
 * exchange (the app's POST a second later) are two requests with no affinity,
 * and when they land on different instances — or the only instance is
 * recycled between them — the code was never seen by the process asked to
 * redeem it. Every such sign-in ended in "That sign-in attempt expired", with
 * nothing in any log, because nothing had gone wrong on either instance.
 *
 * Rows live in auth_states, which already has the property a handoff needs:
 * `DELETE ... RETURNING` makes redemption single-use even when two requests
 * race, and the sweep removes what nobody redeemed. The row carries the
 * USER ID, not a session token — the session is minted only when the code is
 * redeemed, so no bearer credential is ever stored raw (the sessions table
 * holds only hashes, and this must not become the exception) and no session
 * exists for a sign-in nobody completed. It rides in `pkce_verifier`, the
 * column for the server-side secret half of a single-use handshake; a
 * dedicated column is the tidier shape and is a one-line ALTER when the next
 * schema change is hand-run anyway.
 */
export const MOBILE_HANDOFF_TTL_MS = 1000 * 60 * 5;
const MOBILE_HANDOFF_PROVIDER = "mobile-handoff";

export async function createMobileHandoff(userId: string): Promise<string> {
  const code = newToken();
  await getDb().insert(authStates).values({
    state: code,
    provider: MOBILE_HANDOFF_PROVIDER,
    pkceVerifier: userId,
    expiresAt: new Date(Date.now() + MOBILE_HANDOFF_TTL_MS),
  });
  return code;
}

/** Redeems a code exactly once. Null for unknown, already-redeemed, expired,
 *  or a state row that is not a handoff at all (provider scoping means a
 *  leaked OAuth `state` can never be traded for a session). */
export async function consumeMobileHandoff(code: string): Promise<{ userId: string } | null> {
  const [row] = await getDb()
    .delete(authStates)
    .where(and(eq(authStates.state, code), eq(authStates.provider, MOBILE_HANDOFF_PROVIDER)))
    .returning();
  if (!row || !row.pkceVerifier) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return { userId: row.pkceVerifier };
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
