/**
 * server/lib/claim.ts — moving an anonymous library into an account.
 *
 * CONTRACT ONLY. planClaim is unimplemented on purpose: the tests in
 * claim.test.ts were written first, against this signature, so the cases
 * describe what the merge must do rather than what some implementation
 * happened to do. Filling this in is step 3.
 *
 * This is the one function in the codebase where a bug loses someone's data
 * instead of rendering something wrong. A recipe that silently fails to
 * arrive is indistinguishable, to the person who saved it, from one that was
 * deleted.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLIENT NEVER DELETES ITS ANONYMOUS OWNER KEY
 *
 * The obvious tidy-up — "they're signed in now, drop the anonymous key" — is
 * the one thing that turns a recoverable failure into a permanent one. Every
 * part of the recovery path depends on that key still being there:
 *
 *   - claim is retried on every load where a session exists and the key is
 *     not yet marked claimed, so a failed claim heals by itself. Without the
 *     key there is nothing to retry with.
 *   - rows keep user_id NULL until a claim actually succeeds, so they stay
 *     visible under the anonymous scope (owner_key AND user_id IS NULL) the
 *     whole time. Signing out shows them again. They are never orphaned
 *     mid-flight — but only while the browser still holds the key that finds
 *     them.
 *   - a second device merges its own rows on a later login by presenting its
 *     own key, which is what makes "merge on any login" work at all.
 *
 * So: the key is *marked* claimed, never removed — the same rename-don't-
 * delete discipline loadLibrary already uses for the localStorage migration
 * in client/src/lib/storage.ts. If you are here to clean up an owner key that
 * looks stale, this comment is the reason not to.
 * ---------------------------------------------------------------------------
 */

/** One row found under the anonymous owner key being claimed. */
export interface ClaimCandidate {
  id: string;
  /** null when still anonymous. Non-null means it already belongs to someone
   *  — this user (a repeat claim) or another one (never touch it). */
  userId: string | null;
}

export interface ClaimMove {
  fromId: string;
  /** Same as fromId unless the id collided inside the target account. */
  toId: string;
  rekeyed: boolean;
}

export interface ClaimPlan {
  /** Rows to hand to the account, in candidate order. */
  moves: ClaimMove[];
  /** Already owned by the claiming user — a repeat claim, not an error. */
  alreadyMine: string[];
  /** Owned by a different user. Never moved, never rewritten. */
  skippedOwnedByOther: string[];
}

export interface ClaimInput {
  userId: string;
  /** Rows under the owner key being claimed. */
  candidates: ClaimCandidate[];
  /** Recipe ids the claiming user already holds. */
  existingIds: string[];
}

export interface PlanOptions {
  /** Injectable so tests can assert on collision handling deterministically.
   *  Defaults to crypto.randomUUID(). */
  newId?: () => string;
}

/**
 * Decides what a claim should do, without touching the database.
 *
 * Split out from the SQL deliberately: the collision rules are where the data
 * loss lives, and they are worth testing exhaustively without needing a
 * Postgres to do it. The transactional half — all rows move or none do — is
 * asserted separately against a real database.
 */
export function planClaim(_input: ClaimInput, _opts: PlanOptions = {}): ClaimPlan {
  throw new Error(
    "planClaim is not implemented yet — see server/lib/claim.test.ts for the contract."
  );
}
