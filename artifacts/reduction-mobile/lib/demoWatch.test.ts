/**
 * lib/demoWatch.test.ts — "Watch instead", played without a screen: the
 * beats each step makes, that they finish the tour from a clean start, that
 * the state changes only on a tap, and the pace's shape under Reduce
 * Motion and VoiceOver.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PRECHECKED, DEMO_RECIPE } from '../data/demoRecipe';
import { advances, demoGraph, forward, GUIDE_STEPS, nextState, startRun, tapState, type DemoState, type ShowMeAction } from './demoGuide';
import { beatsMs, targetName, WATCH_PACE, WATCH_PACE_REDUCED, watchBeats, type Beat, type WatchOptions } from './demoWatch';

const g = demoGraph(DEMO_RECIPE, DEMO_PRECHECKED);
const CARD_ORDER = ['d1', 'd2', 'd3', 'd4', 'd5'];
const perform = (s: DemoState, a: ShowMeAction): DemoState =>
  a.kind === 'tap' ? tapState(DEMO_RECIPE, s, a.id) : a.kind === 'mode' ? { ...s, mode: a.mode } : nextState(DEMO_RECIPE, s, CARD_ORDER);
const NORMAL: WatchOptions = { reduceMotion: false, screenReader: false };

/** Play the whole tour the way the screen does: run each step's beats,
 *  perform a tap when its beat ends, move on at `advance`. */
function play(o: WatchOptions) {
  let { run, state } = startRun(g);
  const log: { step: string; beats: Beat[]; advanced: boolean; taps: string[] }[] = [];
  for (let guard = 0; guard < 10 && GUIDE_STEPS[run.index].kind !== 'finish'; guard++) {
    const id = GUIDE_STEPS[run.index].id;
    const beats = watchBeats(id, state, g, o);
    let advanced = false;
    const taps: string[] = [];
    for (const b of beats) {
      if (b.kind === 'tap') {
        const next = perform(state, b.action);
        if (advances(id, state, next, g)) advanced = true;
        taps.push(b.target);
        state = next;
      }
      if (b.kind === 'advance') ({ run, state } = forward(run, state, g));
    }
    log.push({ step: id, beats, advanced, taps });
    if (!beats.some((b) => b.kind === 'advance')) break;
  }
  return { run, state, log };
}

test('watching plays the whole tour from a clean start, the avocados first, to the final card', () => {
  const { run, log } = play(NORMAL);
  assert.equal(GUIDE_STEPS[run.index].id, 'finish', 'it ends on the final card');
  assert.deepEqual(log.map((l) => l.step), ['read', 'ingredient', 'ready', 'last', 'cook']);
  assert.deepEqual(log.map((l) => l.taps), [[], ['avocados'], ['d1'], ['d5'], ['mode:steps', 'cook:next']]);
  for (const l of log.filter((x) => x.step !== 'read')) assert.ok(l.advanced, `${l.step}: the watched taps did what the step asks`);
});

test('every action is a pause, then the pointer, then the tap — and only the tap changes anything', () => {
  for (const l of play(NORMAL).log.filter((x) => x.step !== 'read')) {
    const b = l.beats;
    for (let i = 0; i < b.length; i++) {
      if (b[i].kind !== 'point') continue;
      assert.deepEqual([b[i - 1].kind, b[i + 1].kind], ['wait', 'tap'], `${l.step} beat ${i}`);
      const point = b[i] as Extract<Beat, { kind: 'point' }>;
      const tap = b[i + 1] as Extract<Beat, { kind: 'tap' }>;
      assert.equal(point.target, tap.target, 'the ring lands where the pointer went');
      assert.equal((b[i - 1] as { ms: number }).ms, WATCH_PACE.pauseMs);
    }
    assert.equal(b[0].kind, 'wait', 'the instruction shows before anything moves');
    assert.equal(b[b.length - 1].kind, 'advance');
  }
});

test('the pace: about two seconds per action, a second before each, and the tour well under a minute', () => {
  assert.equal(WATCH_PACE.pauseMs, 1000);
  const action = WATCH_PACE.glideMs + WATCH_PACE.tapMs;
  assert.ok(action >= 1800 && action <= 2400, `an action takes ${action}ms`);
  const total = play(NORMAL).log.reduce((t, l) => t + beatsMs(l.beats), 0);
  assert.ok(total > 20_000 && total < 45_000, `the watched tour takes ${total}ms`);
});

test('Reduce Motion: the same taps, every hold longer', () => {
  const normal = play(NORMAL);
  const reduced = play({ reduceMotion: true, screenReader: false });
  assert.deepEqual(reduced.log.map((l) => l.taps), normal.log.map((l) => l.taps));
  assert.equal(GUIDE_STEPS[reduced.run.index].id, 'finish');
  for (const k of ['leadInMs', 'afterMs', 'readMs'] as const) assert.ok(WATCH_PACE_REDUCED[k] > WATCH_PACE[k], k);
  assert.ok(reduced.log.reduce((t, l) => t + beatsMs(l.beats), 0) > normal.log.reduce((t, l) => t + beatsMs(l.beats), 0));
});

test('VoiceOver: each step is performed, and never moves on by itself', () => {
  let { run, state } = startRun(g);
  ({ run, state } = forward(run, state, g)); // step 2, as Next would
  const beats = watchBeats('ingredient', state, g, { reduceMotion: false, screenReader: true });
  assert.ok(beats.some((b) => b.kind === 'tap'), 'it still taps');
  assert.ok(!beats.some((b) => b.kind === 'advance'), 'it never advances');
  assert.ok(!watchBeats('read', state, g, { reduceMotion: false, screenReader: true }).some((b) => b.kind === 'advance'));
});

test('the final card has no beats; the pointer names what it taps', () => {
  assert.deepEqual(watchBeats('finish', { done: [], mode: 'diagram' }, g, NORMAL), []);
  assert.equal(targetName(DEMO_RECIPE, 'avocados'), 'ripe avocados');
  assert.equal(targetName(DEMO_RECIPE, 'd1'), 'halve and scoop');
  assert.equal(targetName(DEMO_RECIPE, 'mode:steps'), 'the Step-by-Step tab');
  assert.equal(targetName(DEMO_RECIPE, 'cook:next'), 'Next Step');
});
