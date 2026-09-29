import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBook, deleteBook, freshDefaultBooks, liveBooks, renameBook, resolveBookId, validateBooks, type BookDef } from '@workspace/recipe-model';
import { OFFLINE_DELETE_MESSAGE, UNAVAILABLE_MESSAGE, createBooksQueue, type BooksState } from './booksQueue';
import { OFFLINE_WINDOW_MS } from './syncEngine';

/** The route, in memory: a version check, a 409 with the current list, a
 *  422 for what validateBooks refuses, and a switch for the network. */
function fakeServer() {
  const s = {
    doc: { books: freshDefaultBooks(), version: 1 },
    online: true,
    unavailable: false,
    puts: 0,
    async load() {
      if (!s.online) throw new Error('Network request failed');
      if (s.unavailable) throw Object.assign(new Error('Recipe books are not available yet.'), { status: 503 });
      return structuredClone(s.doc);
    },
    async put(books: BookDef[], ifVersion: number) {
      s.puts++;
      if (!s.online) throw new Error('Network request failed');
      if (ifVersion !== s.doc.version) throw Object.assign(new Error('changed elsewhere'), { status: 409, body: structuredClone(s.doc) });
      const errors = validateBooks(books);
      if (errors.length) throw Object.assign(new Error('Those books are not valid.'), { status: 422, details: errors });
      s.doc = { books: structuredClone(books), version: s.doc.version + 1 };
      return structuredClone(s.doc);
    },
    /** Another device's write, straight to the server. */
    elsewhere(change: (b: BookDef[]) => BookDef[]) {
      s.doc = { books: change(structuredClone(s.doc.books)), version: s.doc.version + 1 };
    },
  };
  return s;
}

function setup(clock = { t: 1_000 }) {
  const server = fakeServer();
  const seen: BooksState[] = [];
  const failures: string[] = [];
  const q = createBooksQueue(server, { onChange: (st) => seen.push(st), onFailure: (m) => failures.push(m) }, { now: () => clock.t });
  return { server, q, seen, failures, clock };
}
const names = (books: BookDef[]) => liveBooks(books).map((b) => b.name);
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the seven defaults load; an edit shows at once and is sent with its version', async () => {
  const { server, q } = setup();
  await q.load();
  assert.equal(q.state().available, true);
  assert.equal(names(q.state().books).length, 7);
  q.edit((b) => addBook(b, { id: 'soups', name: 'Soups', now: 1 }));
  assert.ok(names(q.state().books).includes('Soups'), 'optimistic');
  await q.retry();
  await settle();
  assert.equal(server.doc.version, 2);
  assert.ok(names(server.doc.books).includes('Soups'));
});

test('a 409 merges with what the other device did and sends again: both changes survive', async () => {
  const { server, q } = setup();
  await q.load();
  server.elsewhere((b) => addBook(b, { id: 'bread', name: 'Bread', now: 2 }));
  q.edit((b) => renameBook(b, 'dinner', 'Mains'));
  await settle();
  await q.retry();
  await settle();
  assert.deepEqual(names(server.doc.books).filter((n) => n === 'Bread' || n === 'Mains').sort(), ['Bread', 'Mains']);
  assert.deepEqual(names(q.state().books), names(server.doc.books));
});

test('offline, an edit waits (queued) and lands when the network is back; past the window it is undone and said', async () => {
  const { server, q, failures, clock } = setup();
  await q.load();
  server.online = false;
  q.edit((b) => addBook(b, { id: 'soups', name: 'Soups', now: 1 }));
  await settle();
  assert.equal(q.state().queued, true);
  assert.ok(names(q.state().books).includes('Soups'), 'still on screen');
  server.online = true;
  await q.retry();
  await settle();
  assert.equal(q.state().queued, false);
  assert.ok(names(server.doc.books).includes('Soups'));

  server.online = false;
  q.edit((b) => addBook(b, { id: 'bread', name: 'Bread', now: 2 }));
  await settle();
  clock.t += OFFLINE_WINDOW_MS + 1;
  await q.retry();
  await settle();
  assert.ok(!names(q.state().books).includes('Bread'), 'undone');
  assert.equal(failures.length, 1);
});

test('delete and merge need a connection: offline, nothing changes and the app says so', async () => {
  const { server, q } = setup();
  await q.load();
  q.edit((b) => addBook(b, { id: 'soups', name: 'Soups', now: 1 }));
  await q.retry();
  await settle();
  const before = structuredClone(q.state().books);
  server.online = false;
  const r = await q.editOnline((b) => deleteBook(b, 'soups', { into: 'dinner', now: 5 }));
  assert.deepEqual(r, { ok: false, message: OFFLINE_DELETE_MESSAGE });
  assert.equal(OFFLINE_DELETE_MESSAGE, 'Connect to the internet to delete or merge books.');
  assert.deepEqual(q.state().books, before, 'nothing changed on the phone');
  assert.ok(names(server.doc.books).includes('Soups'), 'nor on the server');

  // Edits already waiting for the network: a delete is refused the same way, without trying.
  q.edit((b) => renameBook(b, 'lunch', 'Midday'));
  await settle();
  const putsBefore = server.puts;
  const r2 = await q.editOnline((b) => deleteBook(b, 'soups', { into: null, now: 6 }));
  assert.deepEqual(r2, { ok: false, message: OFFLINE_DELETE_MESSAGE });
  assert.equal(server.puts, putsBefore, 'not even attempted');
});

test('online, a merge lands at once — and a 409 on it merges and still lands, no recipe lost', async () => {
  const { server, q } = setup();
  await q.load();
  q.edit((b) => addBook(b, { id: 'soups', name: 'Soups', now: 1 }));
  await q.retry();
  await settle();
  server.elsewhere((b) => addBook(b, { id: 'bread', name: 'Bread', now: 2 }));
  const r = await q.editOnline((b) => deleteBook(b, 'soups', { into: 'dinner', rename: 'Dinner & soups', now: 5 }));
  assert.deepEqual(r, { ok: true });
  assert.ok(names(server.doc.books).includes('Bread'), "the other device's book kept");
  assert.ok(names(server.doc.books).includes('Dinner & soups'));
  assert.equal(resolveBookId(server.doc.books, 'soups'), 'dinner');
});

test('without books on the server: today\'s seven, and nothing can be edited', async () => {
  const { server, q } = setup();
  server.unavailable = true;
  await q.load();
  assert.equal(q.state().available, false);
  assert.equal(names(q.state().books).length, 7);
  assert.throws(() => q.edit((b) => b), (e: Error) => e.message === UNAVAILABLE_MESSAGE);
  assert.deepEqual(await q.editOnline((b) => b), { ok: false, message: UNAVAILABLE_MESSAGE });
});

test('a refused write (422) is undone at once and said', async () => {
  const { q, failures } = setup();
  await q.load();
  q.edit((b) => b.filter((x) => x.id !== 'other'));
  await settle();
  await q.retry();
  await settle();
  assert.equal(names(q.state().books).length, 7);
  assert.equal(failures.length, 1);
});
