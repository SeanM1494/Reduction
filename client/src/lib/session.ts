/**
 * client/src/lib/session.ts — signed-in state, and moving an anonymous
 * library into the account behind it.
 *
 * Everything here talks to /api/auth. The session itself lives in an httpOnly
 * cookie, so there is nothing for this file to store or hand around — the
 * server is the only thing that knows, and /api/auth/me is how we ask.
 */

import { currentOwnerKey, markOwnerKeyClaimed, ownerKeyClaimedBy } from "./storage";

export interface SessionUser {
  id: string;
  displayName: string | null;
  email: string | null;
}

/**
 * What the account may do, as the server computed it.
 *
 * PROVIDER-AGNOSTIC ALL THE WAY TO THE UI. There is no `stripeStatus` here
 * and there must never be: `provider` is a label for a support screen, never
 * something to branch behaviour on. When the App Store build adds StoreKit,
 * this type does not change.
 *
 * `enforced` is the resolved kill switch. `allowed === false && enforced ===
 * false` is the shadow state — the wall would have fired and did not — which
 * the UI treats exactly as allowed, because it is.
 */
export interface Entitlement {
  allowed: boolean;
  reason: "subscribed" | "within_allowance" | "exhausted" | "no_account";
  subscribed: boolean;
  status: "active" | "grace" | "expired" | null;
  provider: string | null;
  allowance: number;
  used: number;
  enforced: boolean;
}

export interface SessionState {
  user: SessionUser | null;
  entitlement: Entitlement | null;
}

/** True only when the wall should actually be shown to this person. */
export const isWalled = (e: Entitlement | null | undefined): boolean =>
  !!e && !e.allowed && e.enforced;

export interface ClaimResult {
  moved: number;
  rekeyed: number;
  remaining: number;
  skipped: number;
}

async function authApi(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/auth${path}`, {
    ...init,
    // Same-origin already sends the cookie; stated rather than assumed,
    // because the whole file is meaningless without it.
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Auth request failed (${res.status}).`);
  return body;
}

/**
 * Who is signed in, or null. The replacement for guessing from library size.
 *
 * Retried once on failure, with a short pause. /api/auth/me resolves the
 * session against the database, and the first query after a sleeping Repl
 * wakes can fail — while the library request a moment later succeeds against
 * a warm pool. Failing open to "logged out" then costs a signed-in user their
 * whole app shell, because no session now means the landing page rather than
 * merely a missing name in the nav. One retry converts the common transient
 * case into a slightly slower load instead.
 *
 * A second failure still resolves to logged out. That direction is the safe
 * one: it shows less than the user is entitled to, never more.
 */
export async function fetchSession(): Promise<SessionUser | null> {
  return (await fetchSessionState()).user;
}

/** Session and entitlement in one round trip, so the paywall can render on
 *  first paint rather than after a second fetch resolves. */
export async function fetchSessionState(): Promise<SessionState> {
  try {
    const body = await authApi("/me", { method: "GET" });
    return { user: body.user ?? null, entitlement: body.entitlement ?? null };
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const body = await authApi("/me", { method: "GET" });
      return { user: body.user ?? null, entitlement: body.entitlement ?? null };
    } catch {
      // Rethrow the original: it is the one that describes what actually
      // started going wrong.
      throw first;
    }
  }
}

/** Which sign-in buttons are worth rendering. */
export async function fetchProviders(): Promise<{ google: boolean }> {
  try {
    const body = await authApi("/providers", { method: "GET" });
    return { google: !!body.providers?.google };
  } catch {
    // A provider list we cannot fetch is a provider list we cannot trust —
    // offer nothing rather than a button that fails on click.
    return { google: false };
  }
}

export async function logout(): Promise<void> {
  await authApi("/logout", { method: "POST" });
}

/**
 * Hands this browser's anonymous library to the signed-in account, if that
 * has not already happened.
 *
 * Runs on every load rather than only just after signing in. That is what
 * makes a failed claim heal by itself, and what merges a second device's rows
 * on a later login — the browser presents its own key whenever it has one.
 *
 * The key is marked claimed only when the server reports nothing left behind.
 * A partial result is treated as unfinished, not as success, so the next load
 * tries again.
 */
export async function claimIfNeeded(userId: string): Promise<ClaimResult | null> {
  if (ownerKeyClaimedBy() === userId) return null;

  const result: ClaimResult = await authApi("/claim", {
    method: "POST",
    headers: { "X-Owner-Key": currentOwnerKey() },
  });

  if (result.remaining === 0) markOwnerKeyClaimed(userId);
  else {
    throw new Error(
      `${result.remaining} recipe${result.remaining === 1 ? "" : "s"} could not be moved into your account.`
    );
  }
  return result;
}
