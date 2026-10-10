import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW,
  PRODUCTION,
  channelSuffix,
  onPreview,
  outcomeMessage,
  runningChannel,
  switchToPreview,
  switchToProduction,
  type ChannelApi,
} from './updateChannel';

/** A phone: the saved override, whether a preview update is downloaded,
 *  and every call, in order. Each behavior can be made to fail. */
function phone(opts: {
  start?: string | null;
  previewHas?: 'update' | 'nothing' | 'rollback';
  fail?: Partial<Record<'set' | 'check' | 'fetch' | 'reload', boolean>>;
  alreadyDownloaded?: boolean;
} = {}) {
  const state = { override: opts.start ?? null, previewDownloaded: !!opts.alreadyDownloaded, reloaded: false, calls: [] as string[] };
  const channel = () => state.override ?? PRODUCTION;
  const api: ChannelApi = {
    setChannel(c) {
      state.calls.push(`set:${c}`);
      if (opts.fail?.set) throw new Error('InvalidRequestHeadersOverride');
      state.override = c;
    },
    async check() {
      state.calls.push(`check:${channel()}`);
      if (opts.fail?.check) throw new Error('offline');
      if (channel() !== PREVIEW) return { isAvailable: true, isRollBackToEmbedded: false };
      const has = opts.previewHas ?? 'update';
      return has === 'update' ? { isAvailable: true, isRollBackToEmbedded: false } : has === 'rollback' ? { isAvailable: false, isRollBackToEmbedded: true } : { isAvailable: false, isRollBackToEmbedded: false };
    },
    async fetch() {
      state.calls.push(`fetch:${channel()}`);
      if (opts.fail?.fetch) throw new Error('download failed');
      if (channel() === PREVIEW) {
        const isNew = !state.previewDownloaded;
        state.previewDownloaded = true;
        return { isNew, isRollBackToEmbedded: opts.previewHas === 'rollback' };
      }
      return { isNew: false, isRollBackToEmbedded: false };
    },
    async reload() {
      state.calls.push(`reload:${channel()}`);
      if (opts.fail?.reload) throw new Error('reload refused');
      state.reloaded = true;
    },
  };
  return { api, state };
}

/** The invariant the whole design rests on: the phone is never left asking
 *  preview without a preview update downloaded to run. */
const neverStuck = (s: { override: string | null; previewDownloaded: boolean }) =>
  assert.ok(s.override !== PREVIEW || s.previewDownloaded, `stuck: override ${s.override}, downloaded ${s.previewDownloaded}`);

test('to preview: probe, download, THEN restart — in that order', async () => {
  const { api, state } = phone();
  const out = await switchToPreview(api);
  assert.deepEqual(out, { kind: 'restarting', to: PREVIEW });
  assert.deepEqual(state.calls, ['set:preview', 'check:preview', 'fetch:preview', 'reload:preview']);
  assert.equal(state.override, PREVIEW);
  neverStuck(state);
});

test('preview with nothing on it: the override is cleared at once and nothing is downloaded or restarted', async () => {
  const { api, state } = phone({ previewHas: 'nothing' });
  const out = await switchToPreview(api);
  assert.deepEqual(out, { kind: 'nothing-on-preview' });
  assert.deepEqual(state.calls, ['set:preview', 'check:preview', 'set:null']);
  assert.equal(state.override, null);
  assert.equal(state.reloaded, false);
  assert.match(outcomeMessage(out), /no update for this version yet\. Staying on production/);
  neverStuck(state);
});

test('preview that only says "roll back to embedded" counts as nothing', async () => {
  const { api, state } = phone({ previewHas: 'rollback' });
  assert.deepEqual(await switchToPreview(api), { kind: 'nothing-on-preview' });
  assert.equal(state.override, null);
  neverStuck(state);
});

test('every failure before the download leaves the phone on production, saved state cleared', async () => {
  for (const step of ['check', 'fetch'] as const) {
    const { api, state } = phone({ fail: { [step]: true } });
    const out = await switchToPreview(api);
    assert.equal(out.kind, 'failed');
    assert.equal(out.kind === 'failed' && out.onChannel, PRODUCTION);
    assert.equal(state.override, null, `${step}: override cleared`);
    assert.equal(state.reloaded, false);
    neverStuck(state);
  }
});

test('a refused override changes nothing and says which step', async () => {
  const { api, state } = phone({ fail: { set: true } });
  const out = await switchToPreview(api);
  assert.deepEqual(out, { kind: 'failed', step: 'switch', message: 'InvalidRequestHeadersOverride', onChannel: PRODUCTION });
  assert.equal(state.override, null);
  assert.match(outcomeMessage(out), /^Could not switch \(InvalidRequestHeadersOverride\)\. On production\.$/);
});

test('a refused restart after the download: on preview, with an update to run, and told to close and reopen', async () => {
  const { api, state } = phone({ fail: { reload: true } });
  const out = await switchToPreview(api);
  assert.equal(out.kind === 'failed' && out.step, 'restart');
  assert.equal(state.override, PREVIEW);
  neverStuck(state);
  assert.match(outcomeMessage(out), /On preview\. Fully close the app and open it again\.$/);
});

test('switching to preview a second time restarts even though the update is already on the phone', async () => {
  const { api, state } = phone({ alreadyDownloaded: true });
  assert.deepEqual(await switchToPreview(api), { kind: 'restarting', to: PREVIEW });
  assert.ok(state.reloaded);
});

test('back to production: override deleted, production fetched, restarted — and a failed fetch still restarts', async () => {
  const ok = phone({ start: PREVIEW, alreadyDownloaded: true });
  assert.deepEqual(await switchToProduction(ok.api), { kind: 'restarting', to: PRODUCTION });
  assert.deepEqual(ok.state.calls, ['set:null', 'fetch:production', 'reload:production']);
  assert.equal(ok.state.override, null);

  const offline = phone({ start: PREVIEW, alreadyDownloaded: true, fail: { fetch: true } });
  assert.deepEqual(await switchToProduction(offline.api), { kind: 'restarting', to: PRODUCTION });
  assert.equal(offline.state.override, null);
});

test('back to production when the override cannot be removed says so, and the phone is still on preview', async () => {
  const { api } = phone({ start: PREVIEW, alreadyDownloaded: true, fail: { set: true } });
  const out = await switchToProduction(api);
  assert.equal(out.kind === 'failed' && out.onChannel, PREVIEW);
});

test('the channel as Settings shows it: nothing on production, " · preview" off it', () => {
  assert.equal(runningChannel(null), PRODUCTION);
  assert.equal(runningChannel(''), PRODUCTION);
  assert.equal(runningChannel(' preview '), PREVIEW);
  assert.equal(channelSuffix('production'), '');
  assert.equal(channelSuffix(null), '');
  assert.equal(channelSuffix('preview'), ' · preview');
  assert.equal(onPreview('preview'), true);
  assert.equal(onPreview('production'), false);
});
