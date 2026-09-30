import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_EMAIL, feedbackBody, feedbackMailto, type FeedbackInfo } from './feedback';

const info: FeedbackInfo = {
  appVersion: '1.1.0',
  build: '7',
  runtimeVersion: '1.1.0',
  updateId: '0e8a3c1e-5f2b-4c1d-9a77-3b2f0c9d4e11',
  os: 'ios',
  osVersion: '26.0',
  model: 'iPhone 15',
};

test('the body leaves room first, then lists version, runtime, update, iOS and model', () => {
  const body = feedbackBody(info);
  const lines = body.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['', '', ''], 'room for the message comes first');
  assert.ok(lines.includes('App version: 1.1.0 (build 7)'));
  assert.ok(lines.includes('Runtime version: 1.1.0'));
  assert.ok(lines.includes('Update: 0e8a3c1e-5f2b-4c1d-9a77-3b2f0c9d4e11'));
  assert.ok(lines.includes('iOS: 26.0'));
  assert.ok(lines.includes('Device: iPhone 15'));
});

test('a build running its own bundle, and anything unknown, still reads plainly', () => {
  const body = feedbackBody({ appVersion: null, build: null, runtimeVersion: null, updateId: null, os: 'ios', osVersion: null, model: null });
  assert.match(body, /Update: none \(built-in\)/);
  assert.match(body, /App version: unknown/);
  assert.match(body, /Device: unknown/);
});

test('the mailto is to the legal pages’ contact, subject "Reduction feedback", fully encoded', () => {
  const url = feedbackMailto(info);
  assert.ok(url.startsWith(`mailto:${FEEDBACK_EMAIL}?subject=Reduction%20feedback&body=`));
  assert.ok(!/[\n ]/.test(url), 'no raw spaces or newlines');
  assert.equal(decodeURIComponent(url.split('&body=')[1]), feedbackBody(info));
});

test('nothing that identifies the person: only the fields it is given', () => {
  // The info type has no account id, email or device NAME to leak, and the
  // body carries no other text that could hold one.
  assert.deepEqual(Object.keys(info).sort(), ['appVersion', 'build', 'model', 'os', 'osVersion', 'runtimeVersion', 'updateId']);
  assert.doesNotMatch(feedbackBody(info), /@|account/i);
});
