/**
 * shared/sync.ts — merging two devices' views of one library entry.
 *
 * The server detects conflicts (a version token and a 409); this file
 * resolves them. Resolution is a three-way merge: `base` is the last state
 * the server acknowledged to THIS device (storage.ts has always kept it, as
 * `lastSynced`), `mine` is local state now, `theirs` is what the server
 * returned with the 409. Per field: changed only by me → mine; changed only
 * by them → theirs; changed by both → the field's own rule below.
 *
 * WHY UNION IS PROVABLY SAFE FOR `done`, NOT JUST PLAUSIBLE
 *
 * Every done set the app produces is upstream-closed: completing a step marks
 * its entire input chain done (RecipeView.toggle walks upstreamOf), and
 * unchecking clears the entire downstream chain. The union of two
 * upstream-closed sets is upstream-closed — take any id in the union, it came
 * from a set that also contained its whole upstream, so the union does too.
 * Which means merging two devices' progress by union can never manufacture
 * the one invalid state ("done step with an input that is not done"), and
 * both devices' cooking survives: the phone's mash branch and the laptop's
 * salsa branch merge to both-done rather than one clobbering the other.
 * sync.test.ts asserts the closure property against generated trees rather
 * than trusting this comment.
 *
 * The one case union gets wrong is UN-checking: my uncheck plus their stale
 * set that still contains the id would resurrect it. So the caller passes the
 * ids this device explicitly uncleared since it last synced, and those are
 * excluded — unless I re-checked them myself since (they are in `mine`).
 * The tombstones are session-local on purpose: they only need to outlive the
 * window between my uncheck and the next successful sync.
 */

import type { Recipe } from "./layout";
import { reconcileDone } from "./progress";

export interface SyncableEntry {
  recipe: Recipe;
  done: string[];
  servings: number | null;
  mode: "diagram" | "steps";
  timer: { stepId: string; endsAt: number } | null;
  /** Timestamps of completed cook-throughs. Merged by union. */
  cooked?: number[];
}

export interface MergeResult {
  merged: SyncableEntry;
  /**
   * True when both sides edited the recipe tree and mine was kept. The one
   * both-changed rule that can discard real work rather than override a
   * preference — the caller MUST surface it, not resolve it quietly. The
   * device whose edit lost learns at its next refetch, when the server tree
   * no longer matches the state it had acknowledged.
   */
  treeConflict: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Element-wise three-way merge of two done sets.
 *
 * With a base, each id's fate is decided by who touched it:
 *   - added by either side  → kept (this is the union half, both cooks count)
 *   - removed by either side and untouched by the other → the removal wins.
 *     A removal is an explicit un-check; the side that still has the id
 *     unchanged from base did nothing to it, so there is no conflict — and
 *     this is what stops a stale device resurrecting an uncheck, in BOTH
 *     directions, without any tombstone.
 *   - removed by one side and RE-present on the other only via the
 *     tombstones: `myRecentUnclears` covers the base-less case and my own
 *     uncheck-vs-their-stale-set case.
 *
 * The result of honouring removals can violate upstream-closure — their
 * removal of an input can strand my completion that was built on it — so
 * `mergeEntry` runs a closure repair against the winning tree afterwards.
 * The repair IS the app's own uncheck semantics: retracting a step retracts
 * everything downstream of it.
 */
export function mergeDone(
  base: string[] | null,
  mine: string[],
  theirs: string[],
  myRecentUnclears: ReadonlySet<string> = new Set()
): string[] {
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  const baseSet = new Set(base ?? []);

  const out: string[] = [];
  const emit = new Set<string>();
  const keep = (id: string) => {
    if (emit.has(id)) return;
    emit.add(id);
    out.push(id);
  };

  for (const id of [...mine, ...theirs]) {
    if (emit.has(id)) continue;
    const inMine = mineSet.has(id);
    const inTheirs = theirsSet.has(id);
    if (inMine && inTheirs) {
      keep(id);
      continue;
    }
    if (inMine) {
      // Absent from theirs. If base had it, theirs removed it — and if I have
      // it merely unchanged from base, their removal wins. If base lacked it,
      // it is my addition and stays.
      if (baseSet.has(id)) continue;
      keep(id);
      continue;
    }
    // In theirs only. Mine removed it (base had it), or I never had it.
    if (baseSet.has(id)) continue; // my removal wins
    if (myRecentUnclears.has(id)) continue; // base-less uncheck, tombstoned
    keep(id);
  }
  return out;
}

/**
 * Drops every done id whose upstream chain is not fully done, cascading —
 * the same rule the app's own un-check applies. Run after a merge that
 * honoured a removal, so a completion built on a retracted input is
 * retracted with it rather than left as a done step with undone inputs.
 */
export function enforceClosure(recipe: Recipe, done: string[]): string[] {
  const inputs = new Map<string, string[]>();
  for (const section of recipe.sections ?? []) {
    for (const n of section.nodes ?? []) inputs.set(n.id, n.inputs ?? []);
  }
  const set = new Set(done);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) {
      const need = inputs.get(id);
      if (!need) continue; // ingredients have no inputs
      for (const i of need) {
        if (!set.has(i)) {
          set.delete(id);
          changed = true;
          break;
        }
      }
    }
  }
  return done.filter((id) => set.has(id));
}

/**
 * Both sides changed the timer. An explicit cancel by me wins — "the screen
 * ignores what I pressed" is the unacceptable outcome — otherwise the later
 * end time wins, since the later-set timer reflects the later intent.
 */
export function mergeTimer(
  mine: SyncableEntry["timer"],
  theirs: SyncableEntry["timer"]
): SyncableEntry["timer"] {
  if (mine === null) return null;
  if (theirs === null) return mine;
  return theirs.endsAt > mine.endsAt ? theirs : mine;
}

/** Union of cook timestamps, deduped within a window: the same cook-through
 *  recorded by two devices a few minutes apart is one meal, not two. */
export function mergeCooked(
  mine: number[] = [],
  theirs: number[] = [],
  windowMs = 6 * 60 * 60 * 1000
): number[] {
  const all = [...mine, ...theirs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) {
    if (out.length && t - out[out.length - 1] < windowMs) continue;
    out.push(t);
  }
  return out;
}

/**
 * The full three-way merge. `base` may be null for an entry the server has
 * never acknowledged to this device — then everything counts as changed by
 * me, and theirs fills the gaps.
 */
export function mergeEntry(
  base: SyncableEntry | null,
  mine: SyncableEntry,
  theirs: SyncableEntry,
  myRecentUnclears: ReadonlySet<string> = new Set()
): MergeResult {
  const changedMine = (k: keyof SyncableEntry) => !base || !same(mine[k], base[k]);
  const changedTheirs = (k: keyof SyncableEntry) => !base || !same(theirs[k], base[k]);

  const pick = <K extends keyof SyncableEntry>(k: K, bothRule: () => SyncableEntry[K]) => {
    const m = changedMine(k);
    const t = changedTheirs(k);
    if (m && t) return same(mine[k], theirs[k]) ? mine[k] : bothRule();
    if (m) return mine[k];
    return theirs[k];
  };

  let treeConflict = false;
  const recipe = pick("recipe", () => {
    // Mine wins: an edit is deliberate, validated work, and the freshest
    // human intent this device can know about. But this is the one rule that
    // can discard the other person's real work — hence the flag.
    treeConflict = true;
    return mine.recipe;
  });

  const done = pick("done", () =>
    mergeDone(base ? base.done : null, mine.done, theirs.done, myRecentUnclears)
  );
  const timer = pick("timer", () => mergeTimer(mine.timer, theirs.timer));
  // mode and servings are UI state the user just set; getting this "wrong"
  // costs one extra tap, getting it wrong the other way ignores a tap.
  const mode = pick("mode", () => mine.mode);
  const servings = pick("servings", () => mine.servings);
  const cooked = pick("cooked", () => mergeCooked(mine.cooked, theirs.cooked));

  // Whatever tree won: done is reconciled against it (no id the tree lost),
  // then closure-repaired (no done step with an undone input — see
  // enforceClosure for why honouring removals makes this necessary).
  const reconciled = enforceClosure(recipe, reconcileDone(recipe, done).done);

  return {
    merged: { recipe, done: reconciled, servings, mode, timer, cooked },
    treeConflict,
  };
}
