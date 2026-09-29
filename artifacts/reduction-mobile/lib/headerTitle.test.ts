import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER_LEFT_PT, HEADER_RIGHT_PT, HEADER_SIDE_PT, TITLE_MIN_PT, titleButtonMaxWidth } from './headerTitle';

test('a centred title (iOS) leaves the wider side free on both sides', () => {
  for (const w of [320, 375, 390, 393, 430]) {
    const max = titleButtonMaxWidth(w, true);
    assert.ok(max + 2 * HEADER_SIDE_PT <= w, `${w}: ${max}`);
  }
  assert.equal(titleButtonMaxWidth(390, true), 206);
  assert.equal(titleButtonMaxWidth(320, true), 136);
});

test('a leading title (Android, web) runs from the back arrow to the menu', () => {
  for (const w of [320, 393, 430]) {
    const max = titleButtonMaxWidth(w, false);
    assert.ok(HEADER_LEFT_PT + max + HEADER_RIGHT_PT <= w, `${w}: ${max}`);
  }
  assert.equal(titleButtonMaxWidth(320, false), 184);
});

test('a short title still gets a thumb-sized target', () => {
  assert.equal(titleButtonMaxWidth(200, true), TITLE_MIN_PT);
  assert.equal(titleButtonMaxWidth(200, false), TITLE_MIN_PT);
});
