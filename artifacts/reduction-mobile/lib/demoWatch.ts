/**
 * lib/demoWatch.ts — "Watch instead": the guided demo, played by itself. PURE.
 *
 * Watching is the SAME six steps as the guide (lib/demoGuide.ts), with the
 * same instruction on screen for the whole of each step, performed by a
 * visible pointer instead of a finger: it glides to the thing the step
 * rings, a ring expands where it taps, and only then does the demo's state
 * change. The taps are the guide's own "Show me" actions, so watching can
 * only ever do what a person could.
 *
 * This file turns a step into BEATS — wait, point, tap, advance — each with
 * a duration. The screen (components/DemoScreen.tsx) only runs them on
 * timers, and Pause, Back and Next only stop, restart or replace them; the
 * pointer itself is drawn inside its target (components/demo/TapPointer.tsx)
 * through the spotlight, so it scrolls with the diagram like the ring.
 *
 * THE PACE IS HERE (Oct 1, the owner's call: about two seconds per action,
 * a one-second pause before each, nobody rushed). Change the numbers below,
 * nowhere else; `demoWatch.test.ts` checks the shape, not the values.
 */

import type { Recipe } from '@/shared/layout';
import { GUIDE_STEPS, showMe, type DemoGraph, type DemoState, type ShowMeAction, type StepId } from './demoGuide';

export const WATCH_PACE = {
  /** A step's instruction alone on screen before its first action. */
  leadInMs: 1500,
  /** Before each action: the pointer is not yet moving. */
  pauseMs: 1000,
  /** The pointer gliding onto its target. */
  glideMs: 1300,
  /** The tap: the ring expands, THEN the state changes. glide + tap ≈ 2s. */
  tapMs: 700,
  /** The result of the last tap seen before the next step's instruction. */
  afterMs: 1000,
  /** A step with nothing to do (step 1, "Read left to right…"). */
  readMs: 4000,
} as const;

/** Reduce Motion: no gliding. The pointer is simply ON the target, the ring
 *  is static, and every step holds longer, since nothing moving draws the
 *  eye from one thing to the next. */
export const WATCH_PACE_REDUCED = {
  leadInMs: 2500,
  pauseMs: 1000,
  /** The pointer shown, still, on its target before the tap. */
  glideMs: 1800,
  tapMs: 900,
  afterMs: 2000,
  readMs: 6000,
} as const;

export type WatchPace = { [K in keyof typeof WATCH_PACE]: number };

export type Beat =
  | { kind: 'wait'; ms: number }
  /** The pointer moves to (or, under Reduce Motion, appears on) `target`. */
  | { kind: 'point'; target: string; ms: number }
  /** The ring expands on `target`; `action` happens when the beat ENDS. */
  | { kind: 'tap'; target: string; action: ShowMeAction; ms: number }
  /** On to the next step. Absent under VoiceOver: Next moves on. */
  | { kind: 'advance' };

export interface WatchOptions {
  reduceMotion: boolean;
  /** VoiceOver (or TalkBack) on: perform the step, never move on by itself. */
  screenReader: boolean;
}

/** What a Show me action points at: an id the spotlight understands. */
export function actionTarget(a: ShowMeAction): string {
  return a.kind === 'tap' ? a.id : a.kind === 'mode' ? 'mode:steps' : 'cook:next';
}

export function paceFor(o: Pick<WatchOptions, 'reduceMotion'>): WatchPace {
  return o.reduceMotion ? WATCH_PACE_REDUCED : WATCH_PACE;
}

/** The beats that play one step, from the state it starts in. */
export function watchBeats(id: StepId, s: DemoState, g: DemoGraph, o: WatchOptions): Beat[] {
  const pace = paceFor(o);
  const step = GUIDE_STEPS.find((x) => x.id === id);
  if (!step || step.kind === 'finish') return [];
  const beats: Beat[] = [];
  if (step.kind === 'read') {
    beats.push({ kind: 'wait', ms: pace.readMs });
  } else {
    beats.push({ kind: 'wait', ms: pace.leadInMs });
    for (const action of showMe(id, s, g)) {
      const target = actionTarget(action);
      beats.push({ kind: 'wait', ms: pace.pauseMs });
      beats.push({ kind: 'point', target, ms: pace.glideMs });
      beats.push({ kind: 'tap', target, action, ms: pace.tapMs });
    }
    beats.push({ kind: 'wait', ms: pace.afterMs });
  }
  if (!o.screenReader) beats.push({ kind: 'advance' });
  return beats;
}

export const beatsMs = (beats: Beat[]) => beats.reduce((t, b) => t + ('ms' in b ? b.ms : 0), 0);

/** What VoiceOver hears for a tap, and what the pointer is labelled. */
export function targetName(recipe: Recipe, target: string): string {
  if (target === 'mode:steps') return 'the Step-by-Step tab';
  if (target === 'cook:next') return 'Next Step';
  for (const s of recipe.sections) {
    const ing = s.ingredients.find((i) => i.id === target);
    if (ing) return ing.name;
    const node = s.nodes.find((n) => n.id === target);
    if (node) return node.label;
  }
  return target;
}
