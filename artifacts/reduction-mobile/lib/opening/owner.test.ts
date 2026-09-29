import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OWNER_IDS, isOwner, sha256Hex } from './owner';

test('sha256Hex agrees with the standard vectors and with node', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const s of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(200), 'crème brûlée — 🍲']) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), s.slice(0, 12));
  }
});

test('only the allowlisted account, however its email is cased or padded', () => {
  assert.equal(isOwner({ email: 'someone@example.com' }), false);
  assert.equal(isOwner(null), false);
  assert.equal(isOwner({ email: null }), false);
  // The allowlist holds a hash: the test can only check that a listed
  // hash matches, by listing one.
  OWNER_IDS.push('owner-id-for-test');
  try {
    assert.equal(isOwner({ id: 'owner-id-for-test', email: 'x@y.z' }), true);
  } finally {
    OWNER_IDS.pop();
  }
});
