/**
 * lib/opening/config.ts — the opening sequence's switches and timelines.
 *
 * PURE: no react-native import, so the runner loads it under node.
 *
 * Every number below comes from the approved prototype
 * (docs/prototypes/opening-sequence.html, its F and Q objects), where each
 * was tuned by eye in a browser. They are the starting point; the owner
 * re-tunes them on a real phone (ROADMAP "The opening sequence").
 */

/** One switch for the whole sequence. `false` and no launch plays it —
 *  flippable over the air. Settings' "Replay intro" still plays it on
 *  purpose. */
export const OPENING_ENABLED = true;

/** A signed-in cold start lands on the Recipe Box (the Library tab), not
 *  Find — on every cold start, not only the ones that play the sequence
 *  (decided Sep 29). `false` restores Find. Never applied over a
 *  notification tap or a link, and never on a return from the background. */
export const LAND_ON_RECIPE_BOX = true;

/** How long a reveal waits for the app underneath before going anyway,
 *  showing whatever loading state the app is in. */
export const MAX_HOLD_S = 1.5;

/** The skip: a tap anywhere fades the overlay to the app. */
export const SKIP_FADE_S = 0.15;

/** A dark-mode launch: the native splash is #131110, so the overlay opens
 *  on that and fades to cream over this long before the pot appears. */
export const DARK_TO_CREAM_S = 0.25;

/** Quick plays on a cold start at most once in this much ELAPSED time. */
export const QUICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Opacity buckets for the things that fade one by one (ripples, a
 *  popping bubble). Each bucket is one drawn path, so this is the knob
 *  between faithful fades and the number of nodes animated per frame. */
export const FADE_LEVELS = 6;

export interface Timeline {
  kind: 'full' | 'quick';
  /** Shaker and bottle tip in, [start, end]. */
  shIn: [number, number];
  spiceS: number;
  spInt: number;
  nSp: number;
  spDur: number;
  dropS: number;
  drInt: number;
  nDr: number;
  drDur: number;
  /** Bubbling starts. */
  bubS: number;
  /** Shaker and bottle leave. */
  out: [number, number];
  /** The camera rises to look into the pot. */
  tilt: [number, number];
  /** The dive into the surface. */
  zoom: [number, number];
  /** The bubble-pop reveal. */
  rev: [number, number];
  total: number;
}

export const FULL: Timeline = {
  kind: 'full',
  shIn: [0.2, 0.7],
  spiceS: 0.6,
  spInt: 0.085,
  nSp: 19,
  spDur: 0.5,
  dropS: 0.8,
  drInt: 0.22,
  nDr: 7,
  drDur: 0.62,
  bubS: 1.0,
  out: [2.1, 2.6],
  tilt: [2.2, 3.0],
  zoom: [2.7, 3.7],
  rev: [3.45, 4.15],
  total: 4.3,
};

export const QUICK: Timeline = {
  kind: 'quick',
  shIn: [0.05, 0.35],
  spiceS: 0.25,
  spInt: 0.06,
  nSp: 10,
  spDur: 0.4,
  dropS: 0.35,
  drInt: 0.16,
  nDr: 4,
  drDur: 0.5,
  bubS: 0.3,
  out: [0.85, 1.15],
  tilt: [0.95, 1.4],
  zoom: [1.2, 1.8],
  rev: [1.55, 2.05],
  total: 2.2,
};

/** Reduce Motion: the artwork, still, then a crossfade to the app. */
export const STATIC = { hold: 0.5, fade: 0.4, total: 1.0 } as const;

/** The prototype's bubble counts: 26 large, 18 small. The first thing to
 *  cut if the phone cannot hold 55 fps (ROADMAP's kill criteria). */
export const BUBBLES = { large: 26, small: 18 } as const;
