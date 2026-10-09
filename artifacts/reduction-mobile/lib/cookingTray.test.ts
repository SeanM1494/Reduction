import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Recipe } from '@workspace/recipe-model';
import {
  DONE_FRESH_MS, switchChips, TRAY_TTL_MS, clearAll, clearOne, cookProgress, inTray, moveSignature, pin, pruneMarks, touch, trayList,
  type TrayEntry, type TrayMarks,
} from './cookingTray';

const recipe = (n: number): Recipe =>
  ({
    title: 'T', servings: 4,
    sections: [{
      name: 'Main', root: `s${n}`,
      ingredients: [{ id: 'i1', name: 'flour', qty: 1, unit: 'cup' }],
      nodes: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, label: `step ${i + 1}`, inputs: i === 0 ? ['i1'] : [`s${i}`] })),
    }],
  }) as unknown as Recipe;

const entry = (id: string, done: string[] = [], timer: TrayEntry['timer'] = null, n = 3): TrayEntry =>
  ({ id, recipe: recipe(n), done, timer });

const NOW = 1_000_000_000;

test('progress names the first step not done, in cooking order', () => {
  const p = cookProgress(entry('a', ['s1']));
  assert.equal(p.currentStepId, 's2');
  assert.equal(p.doneSteps, 1);
  assert.equal(p.total, 3);
  assert.equal(p.complete, false);
  assert.equal(cookProgress(entry('a', ['s1', 's2', 's3'])).complete, true);
});

test('a recipe never seen to move is not in the tray, however many ticks it has', () => {
  assert.equal(inTray(entry('a', ['s1']), undefined, NOW), false);
});

test('a touched recipe with some steps done is in; none done is out unless Cook now', () => {
  const marks = touch({}, 'a', NOW);
  assert.equal(inTray(entry('a', ['s1']), marks.a, NOW), true);
  assert.equal(inTray(entry('a', []), marks.a, NOW), false);
  assert.equal(inTray(entry('a', []), pin({}, 'a', NOW).a, NOW), true);
});

test('a finished recipe leaves the tray, even a pinned one', () => {
  assert.equal(inTray(entry('a', ['s1', 's2', 's3']), pin({}, 'a', NOW).a, NOW), false);
});

test('it expires after the TTL unless a timer is still running', () => {
  const marks = touch({}, 'a', NOW);
  const later = NOW + TRAY_TTL_MS + 1;
  assert.equal(inTray(entry('a', ['s1']), marks.a, later), false);
  assert.equal(inTray(entry('a', ['s1'], { stepId: 's2', endsAt: later + 5000 }), marks.a, later), true);
  assert.equal(inTray(entry('a', ['s1'], { stepId: 's2', endsAt: later - 1 }), marks.a, later), false);
});

test('a running timer alone puts a touched recipe in', () => {
  const marks = touch({}, 'a', NOW);
  assert.equal(inTray(entry('a', [], { stepId: 's1', endsAt: NOW + 60_000 }), marks.a, NOW), true);
});

test('clearing leaves the ticks alone and the next touch brings it back', () => {
  let marks: TrayMarks = touch({}, 'a', NOW);
  marks = clearOne(marks, 'a');
  assert.equal(inTray(entry('a', ['s1']), marks.a, NOW), false);
  marks = touch(marks, 'a', NOW + 1);
  assert.equal(inTray(entry('a', ['s1', 's2']), marks.a, NOW + 1), true);
});

test('clearing an unknown recipe invents no mark; Clear all clears each', () => {
  assert.deepEqual(clearOne({}, 'zz'), {});
  let marks = touch(touch({}, 'a', NOW), 'b', NOW);
  marks = clearAll(marks, ['a', 'b']);
  assert.equal(marks.a.cleared && marks.b.cleared, true);
});

test('a touch keeps Cook now; the list is newest movement first', () => {
  let marks = pin({}, 'a', NOW);
  marks = touch(marks, 'a', NOW + 5);
  assert.equal(marks.a.pinned, true);
  marks = touch(marks, 'b', NOW + 9);
  const list = trayList([entry('a', ['s1']), entry('b', ['s1'])], marks, NOW + 10);
  assert.deepEqual(list.map((e) => e.id), ['b', 'a']);
});

test('the move signature changes with ticks and with the timer, not with nothing', () => {
  const a = moveSignature(entry('a', ['s1']));
  assert.equal(a, moveSignature(entry('a', ['s1'])));
  assert.notEqual(a, moveSignature(entry('a', ['s1', 's2'])));
  assert.notEqual(a, moveSignature(entry('a', ['s1'], { stepId: 's2', endsAt: 5 })));
});

test('marks of deleted recipes are dropped', () => {
  const marks = touch(touch({}, 'a', NOW), 'gone', NOW);
  assert.deepEqual(Object.keys(pruneMarks(marks, new Set(['a']))), ['a']);
  assert.equal(pruneMarks(marks, new Set(['a', 'gone'])), marks);
});

test('the switch strip leaves out the recipe you are in, and is empty with nobody else', () => {
  assert.deepEqual(switchChips([entry('a', ['s1'])], 'a', NOW), { chips: [], more: 0 });
});

test('with two others: a finished timer first, then running by when it rings, then the rest', () => {
  const list = [
    entry('idle', ['s1']),
    entry('late', ['s1'], { stepId: 's2', endsAt: NOW + 600_000 }),
    entry('soon', ['s1'], { stepId: 's2', endsAt: NOW + 60_000 }),
    entry('rang', ['s1'], { stepId: 's2', endsAt: NOW - 1000 }),
    entry('me', ['s1']),
  ];
  const { chips, more } = switchChips(list, 'me', NOW);
  assert.deepEqual(chips.map((c) => `${c.entry.id}:${c.state}`), ['rang:done', 'soon:running']);
  assert.equal(more, 2);
});

test('a timer that finished long ago is just another recipe, not an alarm', () => {
  const list = [entry('old', ['s1'], { stepId: 's2', endsAt: NOW - DONE_FRESH_MS - 1 }), entry('me')];
  assert.equal(switchChips(list, 'me', NOW).chips[0].state, 'idle');
});

test('equally idle recipes keep the tray order, newest movement first', () => {
  const list = [entry('x', ['s1']), entry('y', ['s1']), entry('me')];
  assert.deepEqual(switchChips(list, 'me', NOW).chips.map((c) => c.entry.id), ['x', 'y']);
});
