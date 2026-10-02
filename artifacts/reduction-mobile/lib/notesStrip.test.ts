import test from 'node:test';
import assert from 'node:assert/strict';
import { TALL_SCREEN, noteStripFits } from './notesStrip';

test('the note strip: always on a tall screen', () => {
  assert.equal(noteStripFits({ windowHeight: 844, photoSize: null, scaled: true }), true);
  assert.equal(noteStripFits({ windowHeight: TALL_SCREEN, photoSize: null, scaled: false }), true);
});

test('the note strip: on a short screen only beside a photo that already holds it', () => {
  // iPhone SE: a 68pt photo cannot hold Clear progress and the strip (94pt).
  assert.equal(noteStripFits({ windowHeight: 568, photoSize: 68, scaled: false }), false);
  assert.equal(noteStripFits({ windowHeight: 568, photoSize: null, scaled: false }), false);
  // SE 2/3 width (375): a 123pt photo (thumbSize) holds both, not the scaled line too.
  assert.equal(noteStripFits({ windowHeight: 667, photoSize: 123, scaled: false }), true);
  assert.equal(noteStripFits({ windowHeight: 667, photoSize: 123, scaled: true }), false);
  assert.equal(noteStripFits({ windowHeight: 667, photoSize: 144, scaled: true }), true);
});
