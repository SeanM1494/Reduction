/**
 * lib/demoGuide.ts — the guided demo, one instruction at a time. PURE.
 *
 * The demo is the guacamole recipe (data/demoRecipe.ts), starting like a
 * real recipe with nothing checked (Oct 1; it used to open with the
 * avocados checked). Checking the avocados is what makes "halve and scoop"
 * the one ready (amber) step. The guide walks six steps over the REAL demo: each
 * do-step advances when the demo's own state changes the way it asked,
 * never on a click it faked, and a change it did not ask for is a nudge,
 * never a block. Everything here is a function of that state, so the
 * whole flow is tested without a screen.
 *
 * Targets are ids from the recipe's own graph (an ingredient, a step) or
 * one of two named controls ('mode:steps', 'cook:next'). The screen passes
 * them to the diagram and the recipe screen as a `spotlight`, and THEY
 * draw the ring and the dimming — the guide never measures or reaches into
 * their markup, which is also why the ring scrolls with the diagram and
 * stays put in its pinned first column.
 */

import type { Recipe } from '@/shared/layout';
import { toggleDone } from './doneClosure';

export type DemoMode = 'diagram' | 'steps';
export interface DemoState {
  done: string[];
  mode: DemoMode;
}

export type StepKind = 'read' | 'do' | 'finish';
export type StepId = 'read' | 'ingredient' | 'ready' | 'last' | 'cook' | 'finish';

export interface GuideStep {
  id: StepId;
  kind: StepKind;
  /** About a dozen words; ROADMAP carries the current wording to tweak. */
  text: string;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'read', kind: 'read', text: 'Read left to right: ingredients feed steps, and steps feed later steps.' },
  { id: 'ingredient', kind: 'do', text: 'Tap the ripe avocados to check them off.' },
  { id: 'ready', kind: 'do', text: 'Amber means ready. Tap halve and scoop.' },
  { id: 'last', kind: 'do', text: 'Tap the last step. It checks off everything before it.' },
  { id: 'cook', kind: 'do', text: 'Checks cleared. Switch to Step-by-Step, then tap Next Step.' },
  { id: 'finish', kind: 'finish', text: "That's it. Add your own recipe." },
];

/** The nudge for a tap the step did not ask for. */
export const NUDGE = 'Tap the highlighted one to go on.';
/** Idle this long on a do-step and "Show me" is offered. */
export const SHOW_ME_AFTER_MS = 6000;

export interface DemoGraph {
  ingredients: string[];
  ops: string[];
  inputsOf: Map<string, string[]>;
  root: string;
  prechecked: string[];
  /** The step the guide makes ready first: the first step fed by
   *  ingredients alone, with the fewest of them ("halve and scoop", fed by
   *  the avocados). Steps 2 and 3 name it and its ingredients. */
  starter: string;
  starterInputs: string[];
}

export function demoGraph(recipe: Recipe, prechecked: string[]): DemoGraph {
  const section = recipe.sections[0];
  const inputsOf = new Map<string, string[]>();
  for (const n of section.nodes) inputsOf.set(n.id, n.inputs ?? []);
  const ingredients = section.ingredients.map((i) => i.id);
  const isIngredient = new Set(ingredients);
  const fedByIngredients = section.nodes.filter((n) => (n.inputs ?? []).length > 0 && (n.inputs ?? []).every((i) => isIngredient.has(i)));
  const starter = fedByIngredients.reduce((a, b) => ((b.inputs ?? []).length < (a.inputs ?? []).length ? b : a), fedByIngredients[0]);
  return {
    ingredients,
    ops: section.nodes.map((n) => n.id),
    inputsOf,
    root: section.root ?? section.nodes[section.nodes.length - 1].id,
    prechecked,
    starter: starter.id,
    starterInputs: [...(starter.inputs ?? [])],
  };
}

export const counter = (index: number) => `${index + 1} of ${GUIDE_STEPS.length}`;

/** Steps whose inputs are all done and which are not done themselves: the
 *  diagram's amber. */
export function readyOps(g: DemoGraph, done: Set<string>): string[] {
  return g.ops.filter((id) => !done.has(id) && (g.inputsOf.get(id) ?? []).every((i) => done.has(i)));
}

/** The state a step starts from when it is reached going FORWARD. A step
 *  that needs something to be true makes it true, visibly and in words:
 *  "Tap the ripe avocados" needs them unchecked, "Tap halve and scoop"
 *  needs it amber (its avocados in, itself not done), "the last step"
 *  needs it not done yet, and Step-by-Step starts from nothing checked
 *  after "the last step" has checked everything. */
export function enterState(id: StepId, s: DemoState, g: DemoGraph): DemoState {
  const fresh: DemoState = { done: [...g.prechecked], mode: 'diagram' };
  if (id === 'read' || id === 'cook') return fresh;
  const done = new Set(s.done);
  const ops = new Set(g.ops);
  if (id === 'ingredient') {
    if (!g.starterInputs.every((i) => done.has(i))) return { ...s, mode: 'diagram' };
    // Keep the other ingredients they checked; take back the avocados and
    // every step (each one is downstream of something being unchecked).
    const inputs = new Set(g.starterInputs);
    return { done: s.done.filter((x) => !ops.has(x) && !inputs.has(x)), mode: 'diagram' };
  }
  if (id === 'ready') {
    if (readyOps(g, done).includes(g.starter)) return { ...s, mode: 'diagram' };
    // Keep the ingredients they checked, add the avocados, drop the steps:
    // halve and scoop is then amber, as the instruction says.
    const kept = Array.from(new Set([...s.done.filter((x) => !ops.has(x)), ...g.starterInputs]));
    return { done: kept, mode: 'diagram' };
  }
  if (id === 'last') return done.has(g.root) ? fresh : { ...s, mode: 'diagram' };
  return s;
}

/** A do-step left with nothing to tap — a tap it did not ask for used up
 *  what it needed (every ingredient checked, nothing amber). The screen
 *  puts the step back where it began rather than leave only Skip. */
export function stranded(id: StepId, s: DemoState, g: DemoGraph): boolean {
  const step = GUIDE_STEPS.find((x) => x.id === id);
  return step?.kind === 'do' && targetsFor(id, s, g).length === 0;
}

/** What to ring. Empty on a step that has nothing to tap. */
export function targetsFor(id: StepId, s: DemoState, g: DemoGraph): string[] {
  const done = new Set(s.done);
  switch (id) {
    case 'ingredient':
      // The avocados, by name in the instruction.
      return g.starterInputs.filter((i) => !done.has(i));
    case 'ready':
      // Halve and scoop, by name — even when another step is amber too.
      return readyOps(g, done).includes(g.starter) ? [g.starter] : [];
    case 'last':
      return done.has(g.root) ? [] : [g.root];
    case 'cook':
      return s.mode === 'steps' ? ['cook:next'] : ['mode:steps'];
    default:
      return [];
  }
}

/** Whether the rest of the diagram dims around the targets. Only while
 *  there is a diagram target to point at; a control target (the mode tab)
 *  dims the whole diagram so the eye goes to the tab. */
export function dimsFor(id: StepId, s: DemoState, g: DemoGraph): boolean {
  const t = targetsFor(id, s, g);
  return t.length > 0 && s.mode === 'diagram';
}

const added = (prev: DemoState, next: DemoState) => {
  const p = new Set(prev.done);
  return next.done.filter((x) => !p.has(x));
};
const removed = (prev: DemoState, next: DemoState) => {
  const n = new Set(next.done);
  return prev.done.filter((x) => !n.has(x));
};

/** Did this change (one tap's worth) do what the step asked? */
export function advances(id: StepId, prev: DemoState, next: DemoState, g: DemoGraph): boolean {
  const plus = added(prev, next);
  const ops = new Set(g.ops);
  switch (id) {
    case 'ingredient':
      // The avocados checked by this tap, and no step with them.
      return plus.some((x) => g.starterInputs.includes(x)) && plus.every((x) => !ops.has(x)) && g.starterInputs.every((i) => next.done.includes(i));
    case 'ready': {
      // Halve and scoop, alone, while it was amber.
      const newOps = plus.filter((x) => ops.has(x));
      return newOps.length === 1 && newOps[0] === g.starter && readyOps(g, new Set(prev.done)).includes(g.starter);
    }
    case 'last':
      return next.done.includes(g.root);
    case 'cook':
      return next.mode === 'steps' && plus.some((x) => ops.has(x));
    default:
      return false;
  }
}

/** A change the step did not ask for — shown the nudge, never blocked. The
 *  first half of the Step-by-Step step (switching the tab) is progress. */
export function isWrongMove(id: StepId, prev: DemoState, next: DemoState, g: DemoGraph): boolean {
  if (advances(id, prev, next, g)) return false;
  const doneChanged = added(prev, next).length > 0 || removed(prev, next).length > 0;
  if (id === 'cook') return doneChanged || (next.mode !== prev.mode && next.mode !== 'steps');
  if (id === 'read' || id === 'finish') return false;
  return doneChanged || next.mode !== prev.mode;
}

export type ShowMeAction = { kind: 'tap'; id: string } | { kind: 'mode'; mode: DemoMode } | { kind: 'next' };

/** What "Show me" performs, in order. */
export function showMe(id: StepId, s: DemoState, g: DemoGraph): ShowMeAction[] {
  const t = targetsFor(id, s, g);
  switch (id) {
    case 'ingredient':
    case 'ready':
    case 'last':
      return t.length ? [{ kind: 'tap', id: t[0] }] : [];
    case 'cook':
      return s.mode === 'steps' ? [{ kind: 'next' }] : [{ kind: 'mode', mode: 'steps' }, { kind: 'next' }];
    default:
      return [];
  }
}

/** A "tap" performed the way a real tap is: the diagram's own rule. */
export function tapState(recipe: Recipe, s: DemoState, id: string): DemoState {
  return { ...s, done: toggleDone(recipe, s.done, id) };
}

/** "Next step" in Step-by-Step on a fresh demo: the first step in cooking
 *  order that is not done (the card on screen), done with its upstream. */
export function nextState(recipe: Recipe, s: DemoState, cardOrder: string[]): DemoState {
  const done = new Set(s.done);
  const first = cardOrder.find((id) => !done.has(id));
  return first ? tapState(recipe, s, first) : s;
}

/** The guide's position and each step's starting snapshot, for Back. */
export interface GuideRun {
  index: number;
  /** snapshots[i] is the state step i started from. */
  snapshots: DemoState[];
}

export function startRun(g: DemoGraph): { run: GuideRun; state: DemoState } {
  const state = enterState('read', { done: [], mode: 'diagram' }, g);
  return { run: { index: 0, snapshots: [state] }, state };
}

/** Forward — by doing the step, Next or Skip. */
export function forward(run: GuideRun, s: DemoState, g: DemoGraph): { run: GuideRun; state: DemoState } {
  const index = Math.min(GUIDE_STEPS.length - 1, run.index + 1);
  const state = enterState(GUIDE_STEPS[index].id, s, g);
  return { run: { index, snapshots: [...run.snapshots.slice(0, index), state] }, state };
}

/** Back — to the previous step, as it was when that step began. From the
 *  first step, back out of the guide (null). */
export function back(run: GuideRun): { run: GuideRun; state: DemoState } | null {
  if (run.index === 0) return null;
  const index = run.index - 1;
  return { run: { index, snapshots: run.snapshots.slice(0, index + 1) }, state: run.snapshots[index] };
}
