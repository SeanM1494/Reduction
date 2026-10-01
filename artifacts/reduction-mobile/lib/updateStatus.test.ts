import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, updateRows, versionLine, when, type UpdateSnapshot } from './updateStatus';

const now = new Date('2026-10-01T16:00:00Z');
const base: UpdateSnapshot = {
  enabled: true,
  updateId: '0e8a3c1e-5f2b-4c1d-9a77-3b2f0c9d4e11',
  channel: 'production',
  runtimeVersion: '1.1.0',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
  createdAt: new Date('2026-10-01T14:03:00Z'),
  lastCheck: new Date('2026-10-01T15:58:00Z'),
  isUpdatePending: false,
  checkError: null,
  downloadError: null,
};
const value = (s: UpdateSnapshot, label: string) => updateRows(s, now).find((r) => r.label === label)?.value;

test('the version line names the binary, and drops what it does not know', () => {
  assert.equal(versionLine('1.1.0', '12'), 'Version 1.1.0 (build 12)');
  assert.equal(versionLine('1.1.0', null), 'Version 1.1.0');
  assert.equal(versionLine(null, '12'), null);
});

test('an update launch names its short id, channel, runtime and publish time in UTC', () => {
  assert.equal(shortId(base.updateId), '0e8a3c1e');
  assert.equal(value(base, 'Running'), 'Update 0e8a3c1e');
  assert.equal(value(base, 'Channel'), 'production');
  assert.equal(value(base, 'Runtime version'), '1.1.0');
  assert.equal(value(base, 'Published'), '2026-10-01 14:03 UTC (1 h ago)');
  assert.equal(value(base, 'Last check'), '2026-10-01 15:58 UTC (2 min ago)');
  assert.equal(value(base, 'Update error'), 'none');
  assert.equal(value(base, 'Waiting'), undefined);
});

test('the embedded bundle says so, and its time is when it was built', () => {
  const s = { ...base, isEmbeddedLaunch: true };
  assert.match(value(s, 'Running')!, /^Embedded bundle/);
  assert.ok(value(s, 'Built'));
  assert.equal(value(s, 'Published'), undefined);
});

test('an emergency launch, a pending update and both errors are all shown', () => {
  const s = { ...base, isEmbeddedLaunch: true, isEmergencyLaunch: true, emergencyLaunchReason: 'the update crashed twice', isUpdatePending: true, checkError: 'Network request failed', downloadError: 'bad manifest', lastCheck: null };
  assert.equal(value(s, 'Running'), 'Embedded bundle — EMERGENCY LAUNCH: the update crashed twice');
  assert.match(value(s, 'Waiting')!, /fully closed and reopened/);
  assert.equal(value(s, 'Update error'), 'check: Network request failed\ndownload: bad manifest');
  assert.equal(value(s, 'Last check'), 'not since this launch');
});

test('a build with updates switched off says only that', () => {
  const rows = updateRows({ ...base, enabled: false }, now);
  assert.equal(rows.length, 1);
  assert.match(rows[0].value, /^Off in this build/);
});

test('times: unknown, future and days', () => {
  assert.equal(when(null, now), 'unknown');
  assert.equal(when(new Date('2026-10-01T17:00:00Z'), now), '2026-10-01 17:00 UTC');
  assert.equal(when(new Date('2026-09-28T16:00:00Z'), now), '2026-09-28 16:00 UTC (3 days ago)');
});
