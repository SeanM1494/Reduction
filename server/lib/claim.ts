/**
 * server/lib/claim.ts — moving an anonymous library into an account.
 *
 * The cases in claim.test.ts were written before this implementation, against
 * the signature below, so they describe what the merge owes rather than what
 * it happens to do.
 *
 * VESTIGIAL, BUT NOT YET REMOVABLE. Anonymous saving is retired (ROADMAP #7):
 * a signed-out browser no longer builds a library, so nothing new will ever
 * need claiming. Rows saved before that change still do, and deleting the
 * only path that can claim them would strand real data. Remove this only
 * after confirming there is nothing left to strand:
 *
 *   select count(*) from recipes
 *   where user_id is null and owner_key not like 'trial:%';
 *
 * Zero, twice, a month apart — then this and claimIfNeeded can go.
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

import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { recipes } from "../../shared/schema";

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
export function planClaim(input: ClaimInput, opts: PlanOptions = {}): ClaimPlan {
  const mintId = opts.newId ?? (() => crypto.randomUUID());

  const moves: ClaimMove[] = [];
  const alreadyMine: string[] = [];
  const skippedOwnedByOther: string[] = [];

  // Sort the candidates first, so every row lands in exactly one bucket and
  // nothing can be dropped between the two passes below.
  const movable: ClaimCandidate[] = [];
  for (const candidate of input.candidates) {
    if (candidate.userId === input.userId) alreadyMine.push(candidate.id);
    else if (candidate.userId !== null) skippedOwnedByOther.push(candidate.id);
    else movable.push(candidate);
  }

  /**
   * Every id the account will hold once this claim is applied. Seeded with
   * what it holds already — including the rows a repeated claim moved on an
   * earlier attempt, which are in `existingIds` too.
   */
  const taken = new Set([...input.existingIds, ...alreadyMine]);

  /**
   * Pass one: decide who keeps their id, reserving as we go.
   *
   * This has to happen before any id is minted. A row that keeps `survivor`
   * is going to occupy that id, so a replacement minted later must not be
   * allowed to take it — and that is only knowable by reserving the keepers
   * up front. Reserving as we go also means two candidates arriving with the
   * same id (impossible under the current primary key, but not something to
   * depend on) resolve as one keeper and one re-key rather than a duplicate.
   */
  const keepsOwnId = new Set<string>();
  for (const candidate of movable) {
    if (taken.has(candidate.id)) continue;
    keepsOwnId.add(candidate.id);
    taken.add(candidate.id);
  }

  // Pass two: emit the moves in candidate order, minting only where needed.
  for (const candidate of movable) {
    if (keepsOwnId.has(candidate.id)) {
      moves.push({ fromId: candidate.id, toId: candidate.id, rekeyed: false });
      continue;
    }
    moves.push({ fromId: candidate.id, toId: mintUnusedId(mintId, taken), rekeyed: true });
  }

  return { moves, alreadyMine, skippedOwnedByOther };
}

/**
 * Draws ids until one is free, then reserves it.
 *
 * A generator is entitled to return something already in use — a real one
 * effectively never will, but the collision this whole function exists to
 * handle is exactly the case of assuming ids are unique when they aren't. The
 * attempt cap turns a pathological generator into a loud failure inside the
 * transaction (which then rolls back, moving nothing) rather than a hang.
 */
function mintUnusedId(mint: () => string, taken: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = mint();
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not mint an unused recipe id after 100 attempts.");
}

// ------------------------------------------------------- the write itself --

export interface ClaimResult {
  /** Rows handed to the account by this call. */
  moved: number;
  /** How many of those needed a new id. */
  rekeyed: number;
  /** Rows still anonymous under this key afterwards. The client only marks
   *  the key claimed when this is 0 — anything else means work is left. */
  remaining: number;
  /** Rows under this key belonging to somebody else, left untouched. */
  skipped: number;
}

export interface ClaimHooks {
  /** Test seam only. Lets a test throw partway through so the all-or-nothing
   *  guarantee can be asserted against a real database rather than assumed. */
  beforeMove?(move: ClaimMove, index: number): void | Promise<void>;
}

/**
 * Moves every anonymous row under `ownerKey` to `userId`, in one transaction.
 *
 * All of it or none of it: a half-applied claim would leave some recipes in
 * the account and some outside it, with the client unable to tell which — and
 * the retry would then be reasoning about a state nobody designed. A failure
 * rolls everything back and the next page load simply tries again.
 *
 * The update carries `user_id IS NULL` in its WHERE on purpose. Two claims
 * racing for the same key (two tabs, both just signed in) then cannot both
 * move the same row: the second finds nothing to update and reports it as
 * already handled rather than overwriting the first.
 */
export async function claimAnonymousLibrary(
  userId: string,
  ownerKey: string,
  hooks: ClaimHooks = {}
): Promise<ClaimResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: recipes.id, userId: recipes.userId })
      .from(recipes)
      .where(eq(recipes.ownerKey, ownerKey));

    const existing = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.userId, userId));

    const plan = planClaim({
      userId,
      candidates,
      existingIds: existing.map((row) => row.id),
    });

    let index = 0;
    for (const move of plan.moves) {
      await hooks.beforeMove?.(move, index++);
      await tx
        .update(recipes)
        .set({ userId, id: move.toId, updatedAt: new Date() })
        .where(
          and(
            eq(recipes.ownerKey, ownerKey),
            eq(recipes.id, move.fromId),
            isNull(recipes.userId)
          )
        );
    }

    // Counted rather than inferred from the plan: if a concurrent claim moved
    // a row out from under this one, the honest answer is what the table says.
    const stillAnonymous = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.ownerKey, ownerKey), isNull(recipes.userId)));

    return {
      moved: plan.moves.length,
      rekeyed: plan.moves.filter((move) => move.rekeyed).length,
      remaining: stillAnonymous.length,
      skipped: plan.skippedOwnedByOther.length,
    };
  });
}
