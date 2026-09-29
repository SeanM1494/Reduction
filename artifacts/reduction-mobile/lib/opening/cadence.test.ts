import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseOpening, quickDue, stampFor, type LaunchFacts } from './cadence';

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12);
const base: LaunchFacts = {
  enabled: true,
  now: NOW,
  fullShown: true,
  lastShownAt: NOW - 30 * H,
  coldStart: true,
  active: true,
  source: 'normal',
  screenReader: false,
  reduceMotion: false,
};
const play = (f: Partial<LaunchFacts>) => chooseOpening({ ...base, ...f });

test('first launch after install: the Full version', () => {
  const d = play({ fullShown: false, lastShownAt: null });
  assert.equal(d.play, 'animated');
  assert.equal(d.version, 'full');
});

test('the Full version is never shown twice, whatever the stamps say', () => {
  assert.equal(play({ fullShown: true, lastShownAt: null }).version, 'quick');
});

test('inside 24 hours of the last start: nothing', () => {
  assert.equal(play({ lastShownAt: NOW - 23 * H }).play, 'none');
  assert.equal(play({ lastShownAt: NOW - 1 }).play, 'none');
});

test('after 24 hours of elapsed time: the Quick version', () => {
  assert.equal(play({ lastShownAt: NOW - 24 * H }).version, 'quick');
  assert.equal(play({ lastShownAt: NOW - 24 * H + 1 }).play, 'none');
});

test('a clock that went backwards (last start in the future) counts as elapsed', () => {
  assert.equal(quickDue(NOW, NOW + 5 * H), true);
  assert.equal(play({ lastShownAt: NOW + 5 * H }).version, 'quick');
});

test('only on a cold start: a return from the background never plays it', () => {
  assert.equal(play({ coldStart: false }).play, 'none');
  assert.equal(play({ coldStart: false, fullShown: false }).play, 'none');
});

test('a background start is not decided until the app is active', () => {
  assert.equal(play({ active: false, fullShown: false }).play, 'none');
});

test('a notification tap, a link or a share goes straight to the app', () => {
  for (const source of ['notification', 'link', 'share'] as const) {
    assert.equal(play({ source }).play, 'none', source);
    assert.equal(play({ source, fullShown: false }).play, 'none', `${source}, first launch`);
  }
});

test('VoiceOver running: skipped', () => {
  assert.equal(play({ screenReader: true, fullShown: false }).play, 'none');
});

test('Reduce Motion: the still, counted as the version it replaced', () => {
  const first = play({ reduceMotion: true, fullShown: false });
  assert.deepEqual([first.play, first.version], ['static', 'full']);
  const later = play({ reduceMotion: true });
  assert.deepEqual([later.play, later.version], ['static', 'quick']);
});

test('the switch turns every launch off', () => {
  assert.equal(play({ enabled: false, fullShown: false }).play, 'none');
});

test('the stamps: Full marks both, Quick marks the time and keeps Full', () => {
  assert.deepEqual(stampFor('full', NOW, { fullShown: false, lastShownAt: null }), { fullShown: true, lastShownAt: NOW });
  assert.deepEqual(stampFor('quick', NOW, { fullShown: true, lastShownAt: 1 }), { fullShown: true, lastShownAt: NOW });
});

test('never both in one launch: a Full start stamps the time, so Quick is not due', () => {
  const after = stampFor('full', NOW, { fullShown: false, lastShownAt: null });
  assert.equal(chooseOpening({ ...base, ...after, now: NOW + 1000 }).play, 'none');
});
