/**
 * lib/demoGuide.test.ts — the guided demo, walked without a screen. Since
 * Oct 1 the demo starts with NOTHING checked: step 2 has the avocados
 * checked, which makes "halve and scoop" the one amber step for step 3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PRECHECKED, DEMO_RECIPE } from '../data/demoRecipe';
import {
  GUIDE_STEPS,
  advances,
  back,
  counter,
  demoGraph,
  dimsFor,
  enterState,
  forward,
  isWrongMove,
  nextState,
  readyOps,
  showMe,
  startRun,
  stranded,
  tapState,
  targetsFor,
  type DemoState,
  type ShowMeAction,
  watchOrder,
} from './demoGuide';

const g = demoGraph(DEMO_RECIPE, DEMO_PRECHECKED);
const CARD_ORDER = ['d1', 'd2', 'd3', 'd4', 'd5'];
const step = (i: number) => GUIDE_STEPS[i].id;
const perform = (s: DemoState, a: ShowMeAction): DemoState =>
  a.kind === 'tap' ? tapState(DEMO_RECIPE, s, a.id) : a.kind === 'mode' ? { ...s, mode: a.mode } : nextState(DEMO_RECIPE, s, CARD_ORDER);

test('six steps, each instruction about a dozen words, counted "n of 6"', () => {
  assert.deepEqual(GUIDE_STEPS.map((s) => s.id), ['read', 'ingredient', 'ready', 'last', 'cook', 'finish']);
  for (const s of GUIDE_STEPS) assert.ok(s.text.split(/\s+/).length <= 14, `${s.id}: ${s.text}`);
  assert.equal(counter(1), '2 of 6');
});

const CLEAN: DemoState = { done: [], mode: 'diagram' };
const tap = (s: DemoState, id: string) => tapState(DEMO_RECIPE, s, id);
const label = (id: string) => DEMO_RECIPE.sections[0].nodes.find((n) => n.id === id)!.label;
const ingName = (id: string) => DEMO_RECIPE.sections[0].ingredients.find((i) => i.id === id)!.name;

test('the demo starts with nothing checked, and nothing is amber until the avocados are', () => {
  assert.deepEqual(DEMO_PRECHECKED, []);
  const { state } = startRun(g);
  assert.deepEqual(state, CLEAN);
  assert.deepEqual(readyOps(g, new Set()), [], 'no step is ready on a clean start');
  // Checking the avocados ALONE makes halve and scoop the only ready step.
  assert.deepEqual(readyOps(g, new Set(tap(CLEAN, 'avocados').done)), ['d1']);
  assert.deepEqual(tap(CLEAN, 'avocados').done, ['avocados'], 'an ingredient tap checks only itself');
  // ...and no other single ingredient makes anything ready.
  for (const i of g.ingredients.filter((x) => x !== 'avocados')) assert.deepEqual(readyOps(g, new Set([i])), [], i);
});

test('steps 2 and 3 name what the diagram shows: the avocados, then halve and scoop', () => {
  assert.equal(g.starter, 'd1');
  assert.deepEqual(g.starterInputs, ['avocados']);
  assert.ok(GUIDE_STEPS[1].text.includes(ingName('avocados')), GUIDE_STEPS[1].text);
  assert.ok(GUIDE_STEPS[2].text.includes(label('d1')), GUIDE_STEPS[2].text);
  assert.ok(GUIDE_STEPS[3].text.startsWith('Tap the last step'), GUIDE_STEPS[3].text);
});

test('the whole guide, walked with real taps, advances on each real change', () => {
  let { run, state } = startRun(g);
  assert.equal(GUIDE_STEPS[run.index].kind, 'read');
  assert.deepEqual(targetsFor('read', state, g), [], 'nothing to tap on a read step');
  ({ run, state } = forward(run, state, g)); // Next
  assert.deepEqual(state, CLEAN, 'step 2 starts clean');

  // 2: the ripe avocados.
  assert.deepEqual(targetsFor(step(run.index), state, g), ['avocados']);
  let next = tap(state, 'avocados');
  assert.equal(advances('ingredient', state, next, g), true);
  ({ run, state } = forward(run, next, g));

  // 3: halve and scoop is amber now, and the only amber step.
  assert.deepEqual(targetsFor('ready', state, g), ['d1']);
  assert.deepEqual(readyOps(g, new Set(state.done)), ['d1']);
  assert.equal(dimsFor('ready', state, g), true);
  next = tap(state, 'd1');
  assert.equal(advances('ready', state, next, g), true);
  ({ run, state } = forward(run, next, g));

  // 4: the last step checks off everything before it.
  assert.deepEqual(targetsFor('last', state, g), ['d5']);
  next = tap(state, 'd5');
  assert.equal(advances('last', state, next, g), true);
  assert.equal(next.done.length, g.ingredients.length + g.ops.length, 'everything is checked');
  ({ run, state } = forward(run, next, g));

  // 5: the checks are cleared, so Step-by-Step has a step to do.
  assert.deepEqual(state, CLEAN);
  assert.deepEqual(targetsFor('cook', state, g), ['mode:steps']);
  const switched = { ...state, mode: 'steps' as const };
  assert.equal(advances('cook', state, switched, g), false, 'switching is half of it');
  assert.equal(isWrongMove('cook', state, switched, g), false, '...and not a wrong move');
  assert.deepEqual(targetsFor('cook', switched, g), ['cook:next']);
  next = nextState(DEMO_RECIPE, switched, CARD_ORDER);
  assert.equal(advances('cook', switched, next, g), true);
  ({ run, state } = forward(run, next, g));

  assert.equal(GUIDE_STEPS[run.index].kind, 'finish');
  assert.equal(run.snapshots.length, 6);
});

test('wrong taps from a clean start: nudged and kept, never an advance', () => {
  // Step 2, another ingredient first: lime stays checked, the avocados are still asked for.
  const lime = tap(CLEAN, 'lime');
  assert.equal(advances('ingredient', CLEAN, lime, g), false);
  assert.equal(isWrongMove('ingredient', CLEAN, lime, g), true);
  assert.equal(stranded('ingredient', lime, g), false);
  assert.deepEqual(targetsFor('ingredient', lime, g), ['avocados']);
  // ...then the avocados: it advances, and step 3 keeps the lime.
  const both = tap(lime, 'avocados');
  assert.equal(advances('ingredient', lime, both, g), true);
  assert.deepEqual(enterState('ready', both, g).done.sort(), ['avocados', 'lime']);

  // Step 2, a step that is not ready (combine): its four vegetables are
  // checked with it — a nudge, and the avocados still to tap.
  const combine = tap(CLEAN, 'd3');
  assert.equal(advances('ingredient', CLEAN, combine, g), false);
  assert.equal(isWrongMove('ingredient', CLEAN, combine, g), true);
  assert.equal(stranded('ingredient', combine, g), false);

  // Step 2, halve and scoop itself: it checks the avocados WITH the step —
  // not what was asked, and nothing left to tap, so the step is put back.
  const scooped = tap(CLEAN, 'd1');
  assert.equal(advances('ingredient', CLEAN, scooped, g), false);
  assert.equal(stranded('ingredient', scooped, g), true);

  // Step 3, a step that is not ready ("fold together"): it checks
  // everything upstream, halve and scoop included — put back.
  const s3: DemoState = { done: ['avocados'], mode: 'diagram' };
  const fold = tap(s3, 'd4');
  assert.equal(advances('ready', s3, fold, g), false);
  assert.equal(isWrongMove('ready', s3, fold, g), true);
  assert.equal(stranded('ready', fold, g), true);
  // Step 3, another ingredient: a nudge; halve and scoop is still amber.
  const salt = tap(s3, 'salt');
  assert.equal(isWrongMove('ready', s3, salt, g), true);
  assert.deepEqual(targetsFor('ready', salt, g), ['d1']);
  // Step 3, unchecking the avocados: nothing amber, put back.
  const undone = tap(s3, 'avocados');
  assert.equal(stranded('ready', undone, g), true);

  // The last step early (on step 2 or 3): everything checks, put back.
  assert.equal(stranded('ingredient', tap(CLEAN, 'd5'), g), true);
  assert.equal(stranded('ready', tap(s3, 'd5'), g), true);
  assert.equal(isWrongMove('ready', s3, tap(s3, 'd5'), g), true);

  // Read steps never nudge.
  assert.equal(isWrongMove('read', CLEAN, combine, g), false);
});

test('halve and scoop is the target even when another step is amber too', () => {
  // All four vegetables and the avocados: combine AND halve and scoop are amber.
  let s: DemoState = CLEAN;
  for (const i of ['avocados', 'onion', 'tomato', 'jalapeno', 'cilantro']) s = tap(s, i);
  assert.deepEqual(readyOps(g, new Set(s.done)).sort(), ['d1', 'd3']);
  assert.deepEqual(targetsFor('ready', s, g), ['d1']);
  assert.equal(advances('ready', s, tap(s, 'd3'), g), false, 'combine is not the step asked for');
  assert.equal(advances('ready', s, tap(s, 'd1'), g), true);
});

test('"Show me" performs each do-step to its advance', () => {
  let { run, state } = startRun(g);
  ({ run, state } = forward(run, state, g));
  while (GUIDE_STEPS[run.index].kind === 'do') {
    const id = step(run.index);
    const actions = showMe(id, state, g);
    assert.ok(actions.length > 0, `${id} has something to show`);
    let s = state;
    let advanced = false;
    for (const a of actions) {
      const n = perform(s, a);
      if (advances(id, s, n, g)) advanced = true;
      s = n;
    }
    assert.ok(advanced, `${id}: Show me advanced it`);
    ({ run, state } = forward(run, s, g));
  }
  assert.equal(step(run.index), 'finish');
});

test('Back from every step restores the state that step began from, and step 1 is clean', () => {
  let { run, state } = startRun(g);
  const walked: DemoState[] = [state];
  ({ run, state } = forward(run, state, g)); // 2
  walked.push(state);
  ({ run, state } = forward(run, tap(state, 'avocados'), g)); // 3
  walked.push(state);
  ({ run, state } = forward(run, tap(state, 'd1'), g)); // 4
  walked.push(state);
  ({ run, state } = forward(run, tap(state, 'd5'), g)); // 5
  walked.push(state);
  ({ run, state } = forward(run, nextState(DEMO_RECIPE, { ...state, mode: 'steps' }, CARD_ORDER), g)); // 6
  assert.equal(step(run.index), 'finish');
  for (let i = 5; i >= 1; i--) {
    const b = back(run)!;
    assert.equal(b.run.index, i - 1);
    assert.deepEqual(b.state, walked[i - 1], `Back from step ${i + 1}`);
    assert.ok(stranded(step(b.run.index), b.state, g) === false);
    run = b.run;
  }
  assert.deepEqual(walked[0], CLEAN, 'step 1 is clean');
  assert.deepEqual(walked[1], CLEAN, 'step 2 is clean');
  assert.deepEqual(walked[2].done, ['avocados'], 'step 3 begins with only the avocados');
  assert.equal(back(run), null, 'Back from the first step leaves the guide');
});

test('a step makes true what it needs, and says so', () => {
  // Someone unchecked the avocados on step 2 and went on: step 3 checks them.
  const s3 = enterState('ready', { done: ['lime'], mode: 'diagram' }, g);
  assert.deepEqual(s3.done.sort(), ['avocados', 'lime']);
  assert.deepEqual(targetsFor('ready', s3, g), ['d1']);
  // Step 2 entered with the avocados in takes them back (and every step).
  assert.deepEqual(enterState('ingredient', { done: ['avocados', 'd1', 'salt'], mode: 'steps' }, g), { done: ['salt'], mode: 'diagram' });
  // Step 5 starts with the checks cleared and the diagram showing.
  assert.deepEqual(enterState('cook', { done: ['d5'], mode: 'steps' }, g), CLEAN);
  assert.match(GUIDE_STEPS[4].text, /^Checks cleared\./);
});

test('Skip moves on without doing the step, and the next step still has a target', () => {
  let { run, state } = startRun(g);
  ({ run, state } = forward(run, state, g)); // 2
  ({ run, state } = forward(run, state, g)); // skip 2 -> 3: the avocados are checked for it
  assert.deepEqual(targetsFor('ready', state, g), ['d1']);
  for (let i = 0; i < 2; i++) ({ run, state } = forward(run, state, g)); // skip to 5
  assert.equal(step(run.index), 'cook');
  assert.deepEqual(targetsFor('cook', state, g), ['mode:steps']);
});

test('every do-step, entered from ANY state taps can reach, has something to tap', () => {
  // Every state reachable by up to four taps from the clean start.
  const ids = [...g.ingredients, ...g.ops];
  const seen = new Map<string, DemoState>([['', CLEAN]]);
  let frontier: DemoState[] = [CLEAN];
  for (let depth = 0; depth < 4; depth++) {
    const nextFrontier: DemoState[] = [];
    for (const s of frontier) {
      for (const id of ids) {
        const n = tap(s, id);
        const key = [...n.done].sort().join(',');
        if (!seen.has(key)) {
          seen.set(key, n);
          nextFrontier.push(n);
        }
      }
    }
    frontier = nextFrontier;
  }
  assert.ok(seen.size > 50, `explored ${seen.size} states`);
  for (const s of seen.values()) {
    for (const st of GUIDE_STEPS.filter((x) => x.kind === 'do')) {
      const entered = enterState(st.id, { ...s, mode: 'steps' }, g);
      assert.ok(targetsFor(st.id, entered, g).length > 0, `${st.id} from [${s.done}]`);
      assert.equal(stranded(st.id, entered, g), false);
      assert.equal(entered.mode, 'diagram', `${st.id} starts on the diagram`);
      // ...and Show me, from there, completes it.
      let x = entered;
      let ok = false;
      for (const a of showMe(st.id, entered, g)) {
        const n = perform(x, a);
        if (advances(st.id, x, n, g)) ok = true;
        x = n;
      }
      assert.ok(ok, `Show me completes ${st.id} from [${s.done}]`);
    }
  }
});

test('"Watch instead" starts clean and checks the avocados first', () => {
  const order = watchOrder(DEMO_RECIPE.sections[0], DEMO_PRECHECKED);
  assert.equal(order[0], 'avocados');
  assert.equal(order[1], 'd1');
  assert.equal(order[order.length - 1], 'd5');
  assert.equal(order.length, g.ingredients.length + g.ops.length);
});
