/**
 * lib/syncEngine.test.ts — the write path under plain node, against an
 * in-memory server that models the library route: a version per row,
 * a 409 carrying the current row when ifVersion is stale, and the field
 * merge a PATCH performs. PURE NODE, NO REACT NATIVE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatch, createSyncEngine, isNetworkFailure, OFFLINE_WINDOW_MS, type EngineApi, type EngineOptions, type SyncEntry, type SyncFailure, type SyncNotice } from './syncEngine';

interface E extends SyncEntry {}

const RECIPE = {
  title: 'Guac',
  servings: 4,
  sections: [
    {
      name: 'Guac',
      root: 'd2',
      ingredients: [
        { id: 'avo', name: 'avocado' },
        { id: 'lime', name: 'lime' },
      ],
      nodes: [
        { id: 'd1', label: 'halve', inputs: ['avo'] },
        { id: 'd2', label: 'mix', inputs: ['d1', 'lime'] },
      ],
    },
  ],
} as unknown as E['recipe'];

const entry = (over: Partial<E> = {}): E => ({
  id: 'r1',
  recipe: RECIPE,
  done: [],
  servings: null,
  mode: 'diagram',
  timer: null,
  cooked: [],
  rating: null,
  order: null,
  version: 1,
  savedAt: 1,
  ...over,
});

/** The route in miniature. `log` records every call so a test can assert
 *  what went on the wire, and `delay` lets a test hold a request open. */
/** The time the fake server stamps a removal with — deliberately not any
 *  number a client sends, so a test can tell whose clock it is reading. */
const SERVER_STAMP = 9_000_000;

function server(initial: E[] = []) {
  const rows = new Map(initial.map((e) => [e.id, e]));
  const log: Array<{ op: string; id?: string; body?: Record<string, unknown> }> = [];
  let hold: Promise<void> | null = null;
  const api: EngineApi<E> = {
    // The real route leaves removed rows out of the list (routes/library.ts).
    async list() {
      log.push({ op: 'list' });
      return [...rows.values()].filter((r) => r.removedAt == null);
    },
    async create(e) {
      log.push({ op: 'create', id: e.id });
      const row = { ...e, version: 1 };
      rows.set(e.id, row);
      return row;
    },
    async patch(id, body) {
      if (hold) await hold;
      log.push({ op: 'patch', id, body });
      const cur = rows.get(id);
      if (!cur) throw Object.assign(new Error('not found'), { status: 404 });
      if (body.ifVersion !== undefined && body.ifVersion !== cur.version) {
        throw Object.assign(new Error('conflict'), { status: 409, entry: cur });
      }
      const { ifVersion: _v, ...fields } = body;
      // The real route stamps removals itself and keeps the FIRST stamp; the
      // client's number is intent only.
      if ('removedAt' in fields) fields.removedAt = fields.removedAt === null ? null : (cur.removedAt ?? SERVER_STAMP);
      const next = { ...cur, ...fields, version: cur.version + 1 } as E;
      rows.set(id, next);
      return next;
    },
    async remove(id) {
      log.push({ op: 'delete', id });
      rows.delete(id);
    },
  };
  return {
    api,
    rows,
    log,
    /** Another device wrote directly to the server. */
    external(id: string, fields: Partial<E>) {
      const cur = rows.get(id)!;
      rows.set(id, { ...cur, ...fields, version: cur.version + 1 });
    },
    holdPatches(): () => void {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return () => {
        hold = null;
        release();
      };
    },
  };
}

function harness(initial: E[] = [], options: EngineOptions = {}) {
  const s = server(initial);
  const replaced: E[] = [];
  const failures: SyncFailure<E>[] = [];
  const notices: SyncNotice<E>[] = [];
  const deferredLog: string[][] = [];
  const engine = createSyncEngine<E>(
    s.api,
    {
      onReplaced: (e) => replaced.push(e),
      onFailure: (f) => failures.push(f),
      onNotice: (n) => notices.push(n),
      onDeferredChange: (ids) => deferredLog.push(ids),
    },
    options
  );
  return { ...s, engine, replaced, failures, notices, deferredLog };
}

/** The network is down: the transport throws the way fetch does — a bare
 *  Error with no HTTP status. */
function offline(s: ReturnType<typeof server>) {
  const real = { patch: s.api.patch, create: s.api.create };
  s.api.patch = async () => {
    throw new TypeError('Network request failed');
  };
  s.api.create = async () => {
    throw new TypeError('Network request failed');
  };
  return () => {
    s.api.patch = real.patch;
    s.api.create = real.create;
  };
}

test('buildPatch sends only what changed, plus the base version', () => {
  const base = entry({ done: ['avo'], version: 7 });
  assert.equal(buildPatch(base, base), null);
  assert.deepEqual(buildPatch(base, { ...base, done: ['avo', 'd1'] }), { done: ['avo', 'd1'], ifVersion: 7 });
  assert.deepEqual(buildPatch(base, { ...base, mode: 'steps', rating: 1 }), { mode: 'steps', rating: 1, ifVersion: 7 });
  // No base: everything goes, and no ifVersion (the server skips the check).
  const full = buildPatch(null, base)!;
  assert.equal(full.ifVersion, undefined);
  assert.deepEqual(Object.keys(full).sort(), ['cooked', 'done', 'mode', 'order', 'rating', 'recipe', 'servings', 'timer']);
});

test('two fast taps are serialized: the second waits and carries the first ack version, no 409', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  const release = h.holdPatches();
  h.engine.save(entry({ done: ['avo'] }));
  h.engine.save(entry({ done: ['avo', 'd1'] }));
  h.engine.save(entry({ done: ['avo', 'd1', 'lime'] }));
  release();
  await h.engine.idle();
  const patches = h.log.filter((l) => l.op === 'patch');
  // Tap 1 went out; taps 2 and 3 collapsed into one write behind it.
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[0].body, { done: ['avo'], ifVersion: 1 });
  assert.deepEqual(patches[1].body, { done: ['avo', 'd1', 'lime'], ifVersion: 2 });
  assert.deepEqual(h.rows.get('r1')!.done, ['avo', 'd1', 'lime']);
  assert.equal(h.failures.length, 0);
  assert.equal(h.replaced.length, 0);
});

test('a stale write 409s, merges both devices’ progress, and the screen adopts the merge', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  // The other device finished the lime branch while this one was offline.
  h.external('r1', { done: ['lime'] });
  h.engine.save(entry({ done: ['avo', 'd1'] }));
  await h.engine.idle();
  const patches = h.log.filter((l) => l.op === 'patch');
  assert.equal(patches.length, 2, 'one 409, one retry');
  assert.deepEqual(patches[1].body.ifVersion, 2);
  assert.deepEqual([...h.rows.get('r1')!.done].sort(), ['avo', 'd1', 'lime']);
  assert.equal(h.replaced.length, 1);
  assert.deepEqual([...h.replaced[0].done].sort(), ['avo', 'd1', 'lime']);
  assert.equal(h.notices.length, 0, 'progress merging is quiet');
});

test('my un-check beats their stale copy, in both directions', async () => {
  const h = harness([entry({ done: ['avo', 'd1'] })]);
  await h.engine.load();
  h.external('r1', { rating: 1 }); // they changed something else, done untouched
  h.engine.save(entry({ done: ['avo', 'd1'], version: 1 }));
  h.engine.save(entry({ done: [], version: 1 })); // I un-checked everything
  await h.engine.idle();
  assert.deepEqual(h.rows.get('r1')!.done, []);
  assert.equal(h.rows.get('r1')!.rating, 1, 'their rating survived');
});

test('a tree edited on both devices keeps mine and says so', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  const theirs = { ...RECIPE, title: 'Their guac' } as E['recipe'];
  const mine = { ...RECIPE, title: 'My guac' } as E['recipe'];
  h.external('r1', { recipe: theirs });
  h.engine.save(entry({ recipe: mine }));
  await h.engine.idle();
  assert.equal((h.rows.get('r1')!.recipe as { title: string }).title, 'My guac');
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].kind, 'tree_conflict');
});

test('a refused write reports the last accepted state to roll back to', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  h.api.patch = async () => {
    throw Object.assign(new Error('That change was rejected.'), { status: 422, details: ['bad tree'] });
  };
  h.engine.save(entry({ done: ['avo'] }));
  await h.engine.idle();
  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].kind, 'update');
  assert.deepEqual(h.failures[0].details, ['bad tree']);
  assert.deepEqual(h.failures[0].accepted!.done, []);
  assert.deepEqual(h.engine.lastAccepted('r1')!.done, [], 'lastSynced did not advance');
});

test('a create is queued, and an edit made before it lands diffs against the row', async () => {
  const h = harness();
  await h.engine.load();
  const fresh = entry({ id: 'new', version: 0 });
  h.engine.create(fresh);
  h.engine.save({ ...fresh, done: ['avo'] });
  await h.engine.idle();
  assert.deepEqual(h.log.map((l) => l.op), ['list', 'create', 'patch']);
  assert.deepEqual(h.log[2].body, { done: ['avo'], ifVersion: 1 });
  assert.deepEqual(h.rows.get('new')!.done, ['avo']);
});

test('a failed create drops the queue behind it and reports with nothing to roll back to', async () => {
  const h = harness();
  await h.engine.load();
  h.api.create = async () => {
    throw Object.assign(new Error('nope'), { status: 500 });
  };
  const fresh = entry({ id: 'new', version: 0 });
  h.engine.create(fresh);
  h.engine.save({ ...fresh, done: ['avo'] });
  await h.engine.idle();
  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].kind, 'create');
  assert.equal(h.failures[0].accepted, null);
  assert.equal(h.log.filter((l) => l.op === 'patch').length, 0, 'no PATCH against a row that does not exist');
});

test('refresh: clean entries adopt the server, dirty ones merge, remote deletes and creates apply', async () => {
  const h = harness([entry({ id: 'clean' }), entry({ id: 'dirty' }), entry({ id: 'gone' })]);
  const loaded = await h.engine.load();
  // Elsewhere: clean got cooked, dirty got a rating, gone was deleted, born appeared.
  h.external('clean', { done: ['avo', 'd1'] });
  h.external('dirty', { rating: 1 });
  h.rows.delete('gone');
  h.rows.set('born', entry({ id: 'born' }));
  // Here: dirty was edited locally and not yet synced.
  const local = loaded.map((e) => (e.id === 'dirty' ? { ...e, done: ['lime'] } : e));
  const out = await h.engine.refresh(local);
  const byId = new Map(out.map((e) => [e.id, e]));
  assert.deepEqual(byId.get('clean')!.done, ['avo', 'd1']);
  assert.equal(byId.get('dirty')!.rating, 1);
  assert.deepEqual(byId.get('dirty')!.done, ['lime'], 'local edit kept through the merge');
  assert.equal(byId.has('gone'), false);
  assert.equal(byId.has('born'), true);
  // And the next save of dirty pushes exactly the local delta against the fresh version.
  h.engine.save(byId.get('dirty')!);
  await h.engine.idle();
  const last = h.log[h.log.length - 1];
  assert.deepEqual(last.body, { done: ['lime'], ifVersion: 2 });
  assert.equal(h.notices.length, 0);
});

test('refresh adopts the server-owned photo meta, clean or dirty, and a patch never carries it', async () => {
  const h = harness([entry({ id: 'clean' }), entry({ id: 'dirty' })]);
  const loaded = await h.engine.load();
  // The server fetched the page's picture for both after the save.
  h.external('clean', { photo: { version: 1, source: 'page' } } as Partial<E>);
  h.external('dirty', { photo: { version: 2, source: 'user' } } as Partial<E>);
  const local = loaded.map((e) => (e.id === 'dirty' ? { ...e, done: ['lime'] } : e));
  const out = await h.engine.refresh(local);
  const byId = new Map(out.map((e) => [e.id, e]));
  assert.deepEqual(byId.get('clean')!.photo, { version: 1, source: 'page' });
  assert.deepEqual(byId.get('dirty')!.photo, { version: 2, source: 'user' }, 'taken even through a merge');
  assert.deepEqual(byId.get('dirty')!.done, ['lime'], 'the local edit still kept');
  h.engine.save({ ...byId.get('dirty')!, rating: 1 });
  await h.engine.idle();
  const last = h.log[h.log.length - 1];
  assert.equal('photo' in last.body, false, 'server-owned: never in a PATCH');
});

test('refresh tells the loser of a tree conflict, and keeps an unlanded create', async () => {
  const h = harness([entry({ id: 'r1' })]);
  const loaded = await h.engine.load();
  h.external('r1', { recipe: { ...RECIPE, title: 'Theirs' } as E['recipe'] });
  const out = await h.engine.refresh(loaded);
  assert.equal((out[0].recipe as { title: string }).title, 'Theirs');
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].kind, 'remote_update');
  // A create that has not landed is not "deleted elsewhere".
  h.api.create = () => new Promise(() => {}); // never resolves
  h.engine.create(entry({ id: 'pending', version: 0 }));
  const out2 = await h.engine.refresh([...out, entry({ id: 'pending', version: 0 })]);
  assert.equal(out2.some((e) => e.id === 'pending'), true);
});

test('a hydrated cache is a real base: a stale one costs one 409-merge and converges', async () => {
  const h = harness([entry({ done: ['avo'], version: 3 })]);
  // The cache remembers version 2 with nothing done; the server moved on.
  h.engine.hydrate([entry({ done: [], version: 2 })]);
  h.engine.save(entry({ done: ['lime'], version: 2 }));
  await h.engine.idle();
  assert.deepEqual([...h.rows.get('r1')!.done].sort(), ['avo', 'lime']);
  assert.equal(h.log.filter((l) => l.op === 'patch').length, 2);
});

test('a failed delete restores the accepted state', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  h.api.remove = async () => {
    throw Object.assign(new Error('offline'), { status: 0 });
  };
  h.engine.remove('r1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].kind, 'delete');
  assert.equal(h.engine.lastAccepted('r1')!.id, 'r1');
});

// ---------------------------------------------------------- offline ------

test('isNetworkFailure: no HTTP status means the network, a status means the server', () => {
  assert.equal(isNetworkFailure(new TypeError('Network request failed')), true);
  assert.equal(isNetworkFailure(new Error('Request timed out')), true);
  assert.equal(isNetworkFailure(Object.assign(new Error('conflict'), { status: 409 })), false);
  assert.equal(isNetworkFailure(Object.assign(new Error('rejected'), { status: 422 })), false);
  assert.equal(isNetworkFailure(Object.assign(new Error('down'), { status: 503 })), false);
  assert.equal(
    isNetworkFailure(Object.assign(new Error('cancelled'), { cancelled: true })),
    false,
    'a request the caller cancelled has no status either, and must not be queued and replayed'
  );
});

test('offline: a tap is kept, not rolled back, and sends itself when the network returns', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  const online = offline(h);
  h.engine.save(entry({ done: ['avo'] }));
  await h.engine.idle();
  assert.equal(h.failures.length, 0, 'no rollback');
  assert.deepEqual(h.engine.deferredIds(), ['r1']);
  assert.deepEqual(h.deferredLog.at(-1), ['r1']);
  // Still offline: another retry changes nothing and reports nothing.
  h.engine.retry();
  await h.engine.idle();
  assert.equal(h.failures.length, 0);
  assert.deepEqual(h.rows.get('r1')!.done, []);
  online();
  h.engine.retry();
  await h.engine.idle();
  assert.deepEqual(h.rows.get('r1')!.done, ['avo']);
  assert.deepEqual(h.engine.deferredIds(), []);
  assert.deepEqual(h.deferredLog.at(-1), []);
  assert.equal(h.failures.length, 0);
});

test('offline: taps made while waiting collapse into the newest state, sent once', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  const online = offline(h);
  h.engine.save(entry({ done: ['avo'] }));
  await h.engine.idle();
  h.engine.save(entry({ done: ['avo', 'd1'] }));
  h.engine.save(entry({ done: ['avo', 'd1', 'lime'] }));
  await h.engine.idle();
  online();
  const before = h.log.length;
  h.engine.retry();
  await h.engine.idle();
  const patches = h.log.slice(before).filter((l) => l.op === 'patch');
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].body, { done: ['avo', 'd1', 'lime'], ifVersion: 1 });
});

test('offline: past the window the write gives up — rollback and the failure, like an immediate refusal', async () => {
  let clock = 1_000_000;
  const h = harness([entry({ done: ['avo'] })], { now: () => clock });
  await h.engine.load();
  offline(h);
  h.engine.save(entry({ done: ['avo', 'd1'] }));
  await h.engine.idle();
  assert.equal(h.failures.length, 0);
  clock += OFFLINE_WINDOW_MS - 1000;
  h.engine.retry();
  await h.engine.idle();
  assert.equal(h.failures.length, 0, 'inside the window: still waiting');
  clock += 2000;
  h.engine.retry();
  await h.engine.idle();
  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].kind, 'update');
  assert.deepEqual(h.failures[0].accepted!.done, ['avo'], 'rolls back to the last acknowledged state');
  assert.deepEqual(h.engine.deferredIds(), []);
  assert.deepEqual(h.deferredLog.at(-1), []);
});

test('offline: a queued write that lands after the server moved on takes the ordinary 409 merge', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  const online = offline(h);
  // This device, in the dead spot: the avocado branch.
  h.engine.save(entry({ done: ['avo', 'd1'] }));
  await h.engine.idle();
  // Meanwhile the laptop did the lime and rated it.
  h.external('r1', { done: ['lime'], rating: 1 });
  online();
  h.engine.retry();
  await h.engine.idle();
  const patches = h.log.filter((l) => l.op === 'patch');
  assert.equal(patches.length, 2, 'the stale write 409d once and was retried merged');
  assert.deepEqual([...h.rows.get('r1')!.done].sort(), ['avo', 'd1', 'lime']);
  assert.equal(h.rows.get('r1')!.rating, 1);
  assert.equal(h.replaced.length, 1, 'the screen adopted the merge');
  assert.equal(h.failures.length, 0);
  assert.equal(h.notices.length, 0);
});

test('offline: a refresh while a write waits folds the server into the queued write', async () => {
  const h = harness([entry()]);
  const loaded = await h.engine.load();
  const online = offline(h);
  const local = entry({ done: ['avo', 'd1'] });
  h.engine.save(local);
  await h.engine.idle();
  h.external('r1', { rating: 1 });
  // The list call still works (a partial outage) and the screen refreshes.
  const out = await h.engine.refresh([local]);
  assert.equal(out[0].rating, 1);
  assert.deepEqual(out[0].done, ['avo', 'd1']);
  online();
  h.engine.retry();
  await h.engine.idle();
  const last = h.log.filter((l) => l.op === 'patch').at(-1)!;
  assert.deepEqual(last.body, { done: ['avo', 'd1'], ifVersion: 2 }, 'sent against the fresh version, no 409');
  assert.equal(h.rows.get('r1')!.rating, 1);
  void loaded;
});

test('offline: a create waits too, and the edit queued behind it follows once it lands', async () => {
  const h = harness();
  await h.engine.load();
  const online = offline(h);
  const fresh = entry({ id: 'new', version: 0 });
  h.engine.create(fresh);
  await h.engine.idle();
  h.engine.save({ ...fresh, done: ['avo'] });
  await h.engine.idle();
  assert.equal(h.failures.length, 0);
  assert.deepEqual(h.engine.deferredIds(), ['new']);
  online();
  h.engine.retry();
  await h.engine.idle();
  assert.deepEqual(h.log.filter((l) => l.op !== 'list').map((l) => l.op), ['create']);
  assert.deepEqual(h.rows.get('new')!.done, ['avo'], 'the create carried the newest state');
  assert.equal(h.failures.length, 0);
});

test('a real server refusal while others wait is still immediate', async () => {
  const h = harness([entry()]);
  await h.engine.load();
  h.api.patch = async () => {
    throw Object.assign(new Error('That change was rejected.'), { status: 422 });
  };
  h.engine.save(entry({ done: ['avo'] }));
  await h.engine.idle();
  assert.equal(h.failures.length, 1);
  assert.deepEqual(h.engine.deferredIds(), []);
});

// ------------------------------------------------------------ removedAt --

test('buildPatch: a removal and a restore are sent; the server re-stamping one is not a change', () => {
  const base = entry({ version: 3 });
  assert.deepEqual(buildPatch(base, { ...base, removedAt: 1234 }), { removedAt: 1234, ifVersion: 3 });
  const removed = entry({ version: 4, removedAt: SERVER_STAMP });
  assert.deepEqual(buildPatch(removed, { ...removed, removedAt: null }), { removedAt: null, ifVersion: 4 });
  // This device still holds its own clock's number; the server stamped its
  // own. Same state — nothing to send, however many later writes follow.
  assert.equal(buildPatch(removed, { ...removed, removedAt: 1234 }), null);
  assert.deepEqual(buildPatch(removed, { ...removed, removedAt: 1234, rating: -1 }), { rating: -1, ifVersion: 4 });
});

test('removal: the write lands, the next refresh leaves it out, and nothing is re-sent', async () => {
  const h = harness([entry({ id: 'keep' }), entry({ id: 'out' })]);
  const loaded = await h.engine.load();
  const removed = { ...loaded.find((e) => e.id === 'out')!, removedAt: 1234, rating: -1 };
  h.engine.save(removed);
  await h.engine.idle();
  assert.equal(h.rows.get('out')!.removedAt, SERVER_STAMP, 'the server stamped it');
  assert.equal(h.rows.get('out')!.rating, -1, 'and the thumbs-down landed with it');
  const out = await h.engine.refresh([loaded.find((e) => e.id === 'keep')!, removed]);
  assert.deepEqual(out.map((e) => e.id), ['keep']);
  const patches = h.log.filter((l) => l.op === 'patch');
  assert.equal(patches.length, 1, 'one write, no echo');
  assert.equal(h.rows.has('out'), true, 'removed is not deleted: the row is still there');
});

test('removal made offline survives a refresh that happens before it can be sent', async () => {
  const h = harness([entry()]);
  const loaded = await h.engine.load();
  const online = offline(h);
  const removed = { ...loaded[0], removedAt: 1234 };
  h.engine.save(removed);
  await h.engine.idle();
  // The list still works and the server still has it in the box.
  const out = await h.engine.refresh([removed]);
  assert.equal(out.length, 1);
  assert.equal(out[0].removedAt, 1234, 'the pending removal is not undone by a refresh');
  online();
  h.engine.retry();
  await h.engine.idle();
  assert.equal(h.rows.get('r1')!.removedAt, SERVER_STAMP);
});

test('removed on another device while this one had an edit waiting: the edit still lands, and it stays removed', async () => {
  const h = harness([entry()]);
  const loaded = await h.engine.load();
  const online = offline(h);
  // This device rated it and cannot send yet.
  h.engine.save({ ...loaded[0], rating: 1 });
  await h.engine.idle();
  // Meanwhile the other device took it out of the box.
  h.external('r1', { removedAt: SERVER_STAMP });
  const out = await h.engine.refresh([{ ...loaded[0], rating: 1 }]);
  assert.deepEqual(out, [], 'gone from this shelf at the next refresh');
  online();
  h.engine.retry();
  await h.engine.idle();
  const row = h.rows.get('r1')!;
  assert.equal(row.rating, 1, 'the rating was not thrown away');
  assert.equal(row.removedAt, SERVER_STAMP, 'and the write did not quietly restore it');
});

test('undo after the refresh dropped it: the snapshot taken at removal is adopted and restored, via a 409-merge', async () => {
  // library-context's restore(): the list no longer holds the row, so the
  // entry as it was removed is hydrated as the base and the restore sent.
  // That snapshot carries the version from BEFORE the removal landed, so the
  // write is stale on purpose — the merge must still restore it, because
  // this device changed removed-ness against its base and the server did not.
  const h = harness([entry({ id: 'keep' }), entry({ id: 'out' })]);
  const loaded = await h.engine.load();
  const snapshot = { ...loaded.find((e) => e.id === 'out')!, removedAt: 1234, rating: -1 };
  h.engine.save(snapshot);
  await h.engine.idle();
  const out = await h.engine.refresh([loaded.find((e) => e.id === 'keep')!, snapshot]);
  assert.deepEqual(out.map((e) => e.id), ['keep'], 'the refresh left it out');
  h.engine.hydrate([snapshot]);
  h.engine.save({ ...snapshot, removedAt: null });
  await h.engine.idle();
  const row = h.rows.get('out')!;
  assert.equal(row.removedAt, null, 'back in the box');
  assert.equal(row.rating, -1, 'with its thumbs-down kept');
  const again = await h.engine.refresh(out);
  assert.deepEqual(again.map((e) => e.id).sort(), ['keep', 'out'], 'and on the shelf at the next refresh');
});
