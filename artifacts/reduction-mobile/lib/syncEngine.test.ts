/**
 * lib/syncEngine.test.ts — the write path under plain node, against an
 * in-memory server that models the library route: a version per row,
 * a 409 carrying the current row when ifVersion is stale, and the field
 * merge a PATCH performs. PURE NODE, NO REACT NATIVE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatch, createSyncEngine, type EngineApi, type SyncEntry, type SyncFailure, type SyncNotice } from './syncEngine';

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
function server(initial: E[] = []) {
  const rows = new Map(initial.map((e) => [e.id, e]));
  const log: Array<{ op: string; id?: string; body?: Record<string, unknown> }> = [];
  let hold: Promise<void> | null = null;
  const api: EngineApi<E> = {
    async list() {
      log.push({ op: 'list' });
      return [...rows.values()];
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

function harness(initial: E[] = []) {
  const s = server(initial);
  const replaced: E[] = [];
  const failures: SyncFailure<E>[] = [];
  const notices: SyncNotice<E>[] = [];
  const engine = createSyncEngine<E>(s.api, {
    onReplaced: (e) => replaced.push(e),
    onFailure: (f) => failures.push(f),
    onNotice: (n) => notices.push(n),
  });
  return { ...s, engine, replaced, failures, notices };
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
