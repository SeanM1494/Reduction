/**
 * lib/cookingTray.ts — which recipes are being cooked right now, for the
 * pill above the tab bar. PURE, so it is tested under plain node.
 *
 * Nothing here is stored on the server or in the recipe. A recipe is "in the
 * tray" when this phone has SEEN it move recently: a step ticked or
 * un-ticked, a timer started (including from another device, seen at the
 * next refresh), or "Cook now" from its ⋮ menu. The marks that say so live
 * on the phone (AsyncStorage, per account) like the shopping list does.
 *
 * Why a mark at all and not just "some steps ticked": a recipe left half
 * done last month is not being cooked, and nothing on the row says when it
 * was last touched. A recipe never seen to move on this phone is therefore
 * NOT in the tray, which is the safe side — an empty pill, not a stale one.
 *
 * A recipe leaves the tray when: its steps are all done, its mark is older
 * than TRAY_TTL_MS (a running timer holds it), or the person cleared it.
 * Clearing is not Clear progress: the ticks stay, so reopening the recipe
 * finds its place. Touching the recipe again brings it back.
 */

import { cardSequence, countDone, type OrderPreference, type Recipe } from '@workspace/recipe-model';

export const TRAY_TTL_MS = 12 * 60 * 60 * 1000;

export interface TrayMark {
  /** Epoch ms the recipe was last seen to move, or "Cook now" was pressed. */
  at: number;
  /** "Cook now": in the tray before any step is ticked. */
  pinned?: boolean;
  /** Taken out of the tray by the person; the next touch clears this. */
  cleared?: boolean;
}
export type TrayMarks = Record<string, TrayMark>;

/** The slice of an Entry read here — structural, so tests build fixtures. */
export interface TrayEntry {
  id: string;
  recipe: Recipe;
  done: string[];
  timer: { stepId: string; endsAt: number } | null;
  order?: OrderPreference | null;
}

export interface CookProgress {
  total: number;
  doneSteps: number;
  /** The first card not done, in cooking order; null when all are done. */
  currentStepId: string | null;
  complete: boolean;
}

export function cookProgress(e: TrayEntry): CookProgress {
  const ids = cardSequence(e.recipe, e.order ?? undefined).map((s) => s.stepId);
  const done = new Set(e.done);
  const currentStepId = ids.find((id) => !done.has(id)) ?? null;
  return {
    total: ids.length,
    doneSteps: ids.length - ids.filter((id) => !done.has(id)).length,
    currentStepId,
    complete: ids.length > 0 && currentStepId === null,
  };
}

/** What changes when a recipe moves: how many are done, and the timer. */
export const moveSignature = (e: TrayEntry): string => `${countDone(e.done)}|${e.timer?.endsAt ?? ''}`;

const timerRunning = (e: TrayEntry, now: number): boolean => !!e.timer && e.timer.endsAt > now;

export function inTray(e: TrayEntry, mark: TrayMark | undefined, now: number): boolean {
  if (!mark || mark.cleared) return false;
  const running = timerRunning(e, now);
  if (now - mark.at > TRAY_TTL_MS && !running) return false;
  if (running) return true;
  if (cookProgress(e).complete) return false;
  return !!mark.pinned || countDone(e.done) > 0;
}

/** Newest movement first. */
export function trayList<T extends TrayEntry>(entries: T[], marks: TrayMarks, now: number): T[] {
  return entries
    .filter((e) => inTray(e, marks[e.id], now))
    .sort((a, b) => (marks[b.id]?.at ?? 0) - (marks[a.id]?.at ?? 0));
}

/** Seen to move: stamps the time and un-clears. Keeps "Cook now". */
export function touch(marks: TrayMarks, id: string, now: number): TrayMarks {
  return { ...marks, [id]: { at: now, pinned: marks[id]?.pinned } };
}

/** ⋮ → Cook now. */
export function pin(marks: TrayMarks, id: string, now: number): TrayMarks {
  return { ...marks, [id]: { at: now, pinned: true } };
}

/** The ✕ on a row: out of the tray, ticks untouched. */
export function clearOne(marks: TrayMarks, id: string): TrayMarks {
  const m = marks[id];
  return m ? { ...marks, [id]: { at: m.at, cleared: true } } : marks;
}

export function clearAll(marks: TrayMarks, ids: string[]): TrayMarks {
  return ids.reduce((acc, id) => clearOne(acc, id), marks);
}

/** Marks for recipes that no longer exist are dropped so the stored map
 *  does not grow for ever. */
export function pruneMarks(marks: TrayMarks, liveIds: Set<string>): TrayMarks {
  // No recipes known is "the library has not loaded", not "all were deleted":
  // pruning then wipes every mark, and the wipe is persisted. That is how a
  // hard close emptied the tray for good (the marks of a recipe that really
  // goes are pruned the next time any other recipe is known).
  if (liveIds.size === 0) return marks;
  const keys = Object.keys(marks);
  if (keys.every((k) => liveIds.has(k))) return marks;
  return Object.fromEntries(keys.filter((k) => liveIds.has(k)).map((k) => [k, marks[k]]));
}

/** A finished timer is worth shouting about for this long; after it the
 *  recipe is just another one that is cooking. */
export const DONE_FRESH_MS = 30 * 60 * 1000;

export type ChipState = 'done' | 'running' | 'idle';

export interface SwitchChip<T extends TrayEntry> {
  entry: T;
  state: ChipState;
}

export function chipState(e: TrayEntry, now: number): ChipState {
  if (!e.timer) return 'idle';
  if (e.timer.endsAt > now) return 'running';
  return now - e.timer.endsAt <= DONE_FRESH_MS ? 'done' : 'idle';
}

/**
 * What the switch strip under Next step shows while cooking `currentId`:
 * the other recipes in the tray, most urgent first — a timer that has
 * finished, then running timers by when they ring, then the rest by latest
 * movement — at most two as chips, and how many more there are.
 */
export function switchChips<T extends TrayEntry>(
  cooking: T[],
  currentId: string,
  now: number
): { chips: SwitchChip<T>[]; more: number } {
  const rank = { done: 0, running: 1, idle: 2 } as const;
  const others = cooking
    .filter((e) => e.id !== currentId)
    .map((entry, i) => ({ entry, state: chipState(entry, now), i }))
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (a.state === 'running' ? a.entry.timer!.endsAt - b.entry.timer!.endsAt : 0) ||
        a.i - b.i // `cooking` is already newest movement first
    );
  return { chips: others.slice(0, 2).map(({ entry, state }) => ({ entry, state })), more: Math.max(0, others.length - 2) };
}
