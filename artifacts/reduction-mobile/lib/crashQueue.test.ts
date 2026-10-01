import test from 'node:test';
import assert from 'node:assert/strict';
import { crashReportFrom } from '@workspace/recipe-model/crashReport';
import { PER_PROCESS, QUEUE_MAX, claimSend, enqueue, freshSendState, parseQueue } from './crashQueue';

const report = (i: number) => {
  const e = new Error(`boom ${i}`);
  e.stack = `Error: boom\n    at f${i} (main.jsbundle:1:${i})`;
  return crashReportFrom('fatal', e, { platform: 'ios' });
};

test('crash queue: each distinct crash is sent once per process', () => {
  const s = freshSendState();
  assert.equal(claimSend(s, report(1)), true);
  assert.equal(claimSend(s, report(1)), false);
  assert.equal(claimSend(s, report(2)), true);
});

test('crash queue: a process sends at most PER_PROCESS reports', () => {
  const s = freshSendState();
  let sent = 0;
  for (let i = 0; i < PER_PROCESS * 3; i++) if (claimSend(s, report(i))) sent++;
  assert.equal(sent, PER_PROCESS);
});

test('crash queue: the stored queue keeps the newest QUEUE_MAX and survives junk', () => {
  let q = parseQueue(null);
  for (let i = 0; i < QUEUE_MAX + 3; i++) q = enqueue(q, report(i));
  assert.equal(q.length, QUEUE_MAX);
  assert.equal(q.at(-1)!.stack[0], `f${QUEUE_MAX + 2} (main.jsbundle:1:${QUEUE_MAX + 2})`);
  assert.deepEqual(parseQueue(JSON.stringify(q)), q);
  assert.deepEqual(parseQueue('{not json'), []);
  assert.deepEqual(parseQueue(JSON.stringify([{ kind: 'nope' }, q[0]])), [q[0]]);
});
