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

test('the whole guide, walked with real taps, advances on each real change', () => {
  let { run, state } = startRun(g);
  assert.deepEqual(state, { done: DEMO_PRECHECKED, mode: 'diagram' });
  assert.equal(GUIDE_STEPS[run.index].kind, 'read');
  assert.deepEqual(targetsFor('read', state, g), [], 'nothing to tap on a read step');
  ({ run, state } = forward(run, state, g)); // Next

  // 2: tap an ingredient — the highlight suggests lime.
  assert.deepEqual(targetsFor(step(run.index), state, g), ['lime']);
  let next = tapState(DEMO_RECIPE, state, 'lime');
  assert.equal(advances('ingredient', state, next, g), true);
  ({ run, state } = forward(run, next, g));

  // 3: an amber step — halve and scoop is amber from the start.
  assert.deepEqual(targetsFor('ready', state, g), ['d1']);
  assert.equal(dimsFor('ready', state, g), true);
  next = tapState(DEMO_RECIPE, state, 'd1');
  assert.equal(advances('ready', state, next, g), true);
  ({ run, state } = forward(run, next, g));

  // 4: the last step checks off everything before it.
  assert.deepEqual(targetsFor('last', state, g), ['d5']);
  next = tapState(DEMO_RECIPE, state, 'd5');
  assert.equal(advances('last', state, next, g), true);
  assert.equal(next.done.length, g.ingredients.length + g.ops.length, 'everything is checked');
  ({ run, state } = forward(run, next, g));

  // 5: the checks are cleared, so Step-by-Step has a step to do.
  assert.deepEqual(state, { done: DEMO_PRECHECKED, mode: 'diagram' });
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

test('a tap the step did not ask for is a nudge, never an advance', () => {
  const s: DemoState = { done: DEMO_PRECHECKED, mode: 'diagram' };
  // Step 2 asked for an ingredient; tapping a step (which checks its inputs too) is not one.
  const tappedStep = tapState(DEMO_RECIPE, s, 'd3');
  assert.equal(advances('ingredient', s, tappedStep, g), false);
  assert.equal(isWrongMove('ingredient', s, tappedStep, g), true);
  // Step 3 asked for an amber step; "fold together" is not ready.
  const notReady = tapState(DEMO_RECIPE, s, 'd4');
  assert.equal(advances('ready', s, notReady, g), false);
  assert.equal(isWrongMove('ready', s, notReady, g), true);
  // Unchecking is not what any do-step asks.
  assert.equal(isWrongMove('last', s, tapState(DEMO_RECIPE, s, 'avocados'), g), true);
  // Read steps never nudge.
  assert.equal(isWrongMove('read', s, tappedStep, g), false);
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

test('Back restores the state the previous step started from', () => {
  let { run, state } = startRun(g);
  ({ run, state } = forward(run, state, g)); // at 2
  const at2 = state;
  ({ run, state } = forward(run, tapState(DEMO_RECIPE, state, 'lime'), g)); // at 3
  ({ run, state } = forward(run, tapState(DEMO_RECIPE, state, 'd1'), g)); // at 4
  const b = back(run)!;
  assert.equal(b.run.index, 2);
  assert.deepEqual(b.state, b.run.snapshots[2]);
  assert.ok(b.state.done.includes('lime') && !b.state.done.includes('d1'), 'step 3 as it began: lime in, d1 not yet');
  const b2 = back(b.run)!;
  assert.deepEqual(b2.state, at2);
  assert.equal(back({ index: 0, snapshots: [at2] }), null, 'Back from the first step leaves the guide');
});

test('a step makes true what it needs, and says so', () => {
  // Someone unchecked the avocados on step 2: step 3 still has an amber step.
  const unchecked: DemoState = { done: ['lime'], mode: 'diagram' };
  assert.equal(readyOps(g, new Set(unchecked.done)).length, 0);
  const s3 = enterState('ready', unchecked, g);
  assert.ok(readyOps(g, new Set(s3.done)).length > 0);
  // Step 5 starts with the checks cleared and the diagram showing.
  assert.deepEqual(enterState('cook', { done: ['d5'], mode: 'steps' }, g), { done: DEMO_PRECHECKED, mode: 'diagram' });
  assert.match(GUIDE_STEPS[4].text, /^Checks cleared\./);
});

test('Skip moves on without doing the step, and the next step still has a target', () => {
  let { run, state } = startRun(g);
  for (let i = 0; i < 4; i++) ({ run, state } = forward(run, state, g)); // skip to 5
  assert.equal(step(run.index), 'cook');
  assert.deepEqual(targetsFor('cook', state, g), ['mode:steps']);
});

test('every do-step, entered from ANY state taps can reach, has something to tap', () => {
  // Every state reachable by up to four taps from the opening position.
  const ids = [...g.ingredients, ...g.ops];
  const seen = new Map<string, DemoState>();
  let frontier: DemoState[] = [{ done: DEMO_PRECHECKED, mode: 'diagram' }];
  for (let depth = 0; depth < 4; depth++) {
    const nextFrontier: DemoState[] = [];
    for (const s of frontier) {
      for (const id of ids) {
        const n = tapState(DEMO_RECIPE, s, id);
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
    }
  }
});

test('a wrong tap that uses up what a step needs is caught as stranded', () => {
  const s: DemoState = { done: DEMO_PRECHECKED, mode: 'diagram' };
  // On "tap an ingredient", tapping the last step checks every ingredient.
  const all = tapState(DEMO_RECIPE, s, 'd5');
  assert.equal(isWrongMove('ingredient', s, all, g), true);
  assert.equal(stranded('ingredient', all, g), true);
  // On "tap an amber step", unchecking the avocados leaves nothing amber.
  const none = tapState(DEMO_RECIPE, s, 'avocados');
  assert.equal(stranded('ready', none, g), true);
  // Read and finish steps are never stranded; neither is a live do-step.
  assert.equal(stranded('read', none, g), false);
  assert.equal(stranded('ready', s, g), false);
});
