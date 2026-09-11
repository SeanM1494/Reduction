/** lib/photoSize.test.ts — PURE NODE, NO REACT NATIVE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64Bytes, fitLongEdge, formatBytes, LONG_EDGE_PX } from './photoSize';

test('fitLongEdge shrinks only the long edge, and only when it is over the cap', () => {
  assert.deepEqual(fitLongEdge(4032, 3024), { width: LONG_EDGE_PX });
  assert.deepEqual(fitLongEdge(3024, 4032), { height: LONG_EDGE_PX });
  assert.equal(fitLongEdge(1568, 1176), null);
  assert.equal(fitLongEdge(800, 600), null);
  assert.equal(fitLongEdge(0, 600), null);
  assert.deepEqual(fitLongEdge(3000, 3000), { width: LONG_EDGE_PX });
});

test('base64Bytes counts decoded bytes without decoding, data: prefix or not', () => {
  const b64 = Buffer.from('hello world').toString('base64'); // 11 bytes, one =
  assert.equal(base64Bytes(b64), 11);
  assert.equal(base64Bytes(`data:image/jpeg;base64,${b64}`), 11);
  assert.equal(base64Bytes(Buffer.alloc(3000).toString('base64')), 3000);
  assert.equal(base64Bytes(Buffer.alloc(3001).toString('base64')), 3001);
});

test('formatBytes reads like a phone says it', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(410 * 1024), '410 KB');
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB');
});
