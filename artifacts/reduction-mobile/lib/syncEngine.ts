/**
 * lib/syncEngine.ts — the library's write path: the web's storage.ts sync
 * core, ported behind two seams so it can be tested under plain node and
 * wired to any transport.
 *
 * PURE: no react-native, no `@/` alias, no fetch. The transport is an
 * `EngineApi` the caller supplies (lib/library-context.tsx builds one from
 * lib/api.ts), and everything the engine has to tell the screen goes out
 * through `EngineEvents`. syncEngine.test.ts drives it with an in-memory
 * server that models the route's version check and 409 body.
 *
 * THE RULES IT KEEPS (CLAUDE.md, "Sync: the server detects, the client
 * resolves"):
 *
 *  - Every PATCH sends only the fields that changed against `lastSynced`,
 *    plus `ifVersion` from it. Sending unchanged fields is how a stale
 *    device used to clobber a fresh one.
 *  - Writes are serialized per entry: one in flight, the newest state queued
 *    behind it. Without this, cooking taps race their own writes — tap 2's
 *    PATCH carries tap 1's ifVersion and 409s against tap 1's own commit.
 *  - A 409 arrives WITH the server's row, and the client three-way merges
 *    (base = lastSynced, exactly the base a merge needs) and retries from
 *    fresher state. The server never merges.
 *  - A tree conflict is never quiet: the winner hears at merge time, the
 *    loser at its next refresh, through `onNotice`.
 *  - A write the server refused rolls back: `onFailure` carries the last
 *    accepted state, and the screen restores it and says so.
 *  - `refresh` (the focus refetch, an AppState change here) is
 *    load-bearing: it is what makes most conflicts never exist.
 *
 * `lastSynced` is the record of what the server has actually accepted, so it
 * advances per entry only when that entry's write resolves. It may be
 * hydrated from a cache of itself at launch (lib/libraryCache.ts): a cached
 * ack is still an ack, and a stale one costs exactly one 409-merge, which
 * is the machinery working.
 */

import { mergeEntry, type SyncableEntry } from '@workspace/recipe-model';

/** What the engine needs of an entry: the syncable fields plus identity and
 *  the server's version token. lib/api.ts's Entry satisfies it. */
export interface SyncEntry extends SyncableEntry {
  id: string;
  version: number;
  savedAt: number;
}

export interface ConflictError {
  status: number;
  entry?: unknown;
  message?: string;
  details?: string[];
}

export interface EngineApi<E extends SyncEntry> {
  list(): Promise<E[]>;
  create(entry: E): Promise<E>;
  /** Throws a ConflictError-shaped value on a 409, with the server's row. */
  patch(id: string, body: Record<string, unknown>): Promise<E>;
  remove(id: string): Promise<void>;
}

export interface SyncFailure<E> {
  id: string;
  kind: 'create' | 'update' | 'delete';
  message: string;
  details?: string[];
  /** The last version the server accepted, to roll back to. Null when the
   *  entry has never been stored (a failed create: drop it). */
  accepted: E | null;
}

export interface SyncNotice<E> {
  id: string;
  kind: 'tree_conflict' | 'remote_update';
  message: string;
  entry: E;
}

export interface EngineEvents<E extends SyncEntry> {
  /** State changed underneath the screen — a 409 merge. Adopt it, or the
   *  next save would try to un-merge it. */
  onReplaced(entry: E): void;
  onFailure(failure: SyncFailure<E>): void;
  onNotice(notice: SyncNotice<E>): void;
  /** `lastSynced` changed; the caller may persist it. */
  onSyncedChange?(entries: E[]): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const toSyncable = (e: SyncableEntry): SyncableEntry => ({
  recipe: e.recipe,
  done: e.done,
  servings: e.servings,
  mode: e.mode,
  timer: e.timer,
  cooked: e.cooked ?? [],
  rating: e.rating ?? null,
  order: e.order ?? null,
});

const SYNCED_KEYS: Array<keyof SyncableEntry> = ['recipe', 'done', 'servings', 'mode', 'timer', 'cooked', 'rating', 'order'];

/** Only the fields that changed against `base`, plus the version the write
 *  was computed from. Null when nothing changed. */
export function buildPatch(base: SyncEntry | null, entry: SyncEntry): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const mine = toSyncable(entry);
  const theirs = base ? toSyncable(base) : null;
  for (const k of SYNCED_KEYS) {
    if (!theirs || !same(mine[k], theirs[k])) body[k] = mine[k];
  }
  if (Object.keys(body).length === 0) return null;
  if (base) body.ifVersion = base.version;
  return body;
}

/** How many times one logical write follows a 409 with a merge before giving
 *  up. Each retry starts from fresher server state, so two devices converge
 *  in one hop; three covers a third device landing mid-merge. */
const MAX_CONFLICT_RETRIES = 3;

const TREE_CONFLICT = 'This recipe was edited on another device at the same time. Your edit was kept.';
const REMOTE_UPDATE = 'This recipe was changed on another device.';

export function createSyncEngine<E extends SyncEntry>(api: EngineApi<E>, events: EngineEvents<E>) {
  /** What the server last acknowledged, per entry. */
  const lastSynced = new Map<string, E>();
  /** Ids this device un-checked since its last successful sync — see
   *  sync.ts for the one merge question they answer. Session-local. */
  const recentUnclears = new Map<string, Set<string>>();
  /** One in-flight write per entry, the newest state queued behind it. */
  const inFlight = new Map<string, Promise<void>>();
  const pending = new Map<string, E>();
  /** Entries this device created and has not yet heard back about. */
  const creating = new Set<string>();

  const synced = () => events.onSyncedChange?.([...lastSynced.values()]);

  const ack = (entry: E) => {
    lastSynced.set(entry.id, entry);
    synced();
  };

  const lastAccepted = (id: string): E | null => lastSynced.get(id) ?? null;

  const trackUnclears = (id: string, base: E | null, entry: E) => {
    if (!base) return;
    const now = new Set(entry.done);
    let set = recentUnclears.get(id);
    for (const doneId of base.done) {
      if (now.has(doneId)) continue;
      if (!set) recentUnclears.set(id, (set = new Set()));
      set.add(doneId);
    }
    if (set) for (const t of [...set]) if (now.has(t)) set.delete(t);
  };

  const fail = (id: string, kind: SyncFailure<E>['kind'], accepted: E | null, e: unknown) => {
    const err = e as Error & { details?: string[] };
    events.onFailure({ id, kind, message: err?.message || 'Could not save that change.', details: err?.details, accepted });
  };

  async function pushCreate(entry: E): Promise<void> {
    try {
      const acked = await api.create(entry);
      creating.delete(entry.id);
      ack(acked);
    } catch (e) {
      creating.delete(entry.id);
      // Anything queued behind the failed create must not run as a PATCH
      // against a row that does not exist.
      pending.delete(entry.id);
      fail(entry.id, 'create', null, e);
    }
  }

  async function pushUpdate(id: string, first: E): Promise<void> {
    let entry = first;
    let attempt = 0;
    while (true) {
      const base = lastAccepted(id);
      trackUnclears(id, base, entry);
      const body = buildPatch(base, entry);
      if (body === null) return;
      try {
        const acked = await api.patch(id, body);
        ack(acked);
        // The server now knows about the unchecks; the tombstones have done
        // their job for everything the ack covers.
        recentUnclears.delete(id);
        return;
      } catch (e) {
        const err = e as ConflictError;
        if (err?.status === 409 && err.entry && attempt < MAX_CONFLICT_RETRIES) {
          attempt++;
          const theirs = err.entry as E;
          const { merged, treeConflict } = mergeEntry(
            base ? toSyncable(base) : null,
            toSyncable(entry),
            toSyncable(theirs),
            recentUnclears.get(id) ?? new Set()
          );
          entry = { ...entry, ...merged } as E;
          // The merge is now this device's local truth too, or the next save
          // would immediately try to un-merge it.
          ack(theirs);
          events.onReplaced(entry);
          if (treeConflict) events.onNotice({ id, kind: 'tree_conflict', message: TREE_CONFLICT, entry });
          continue;
        }
        throw e;
      }
    }
  }

  /** Serialize writes per entry: one in flight, the newest state queued. */
  function enqueue(id: string, entry: E): void {
    pending.set(id, entry);
    if (inFlight.has(id)) return;
    const run = async () => {
      while (pending.has(id)) {
        const next = pending.get(id)!;
        pending.delete(id);
        if (creating.has(id)) {
          await pushCreate(next);
          continue;
        }
        try {
          await pushUpdate(id, next);
        } catch (e) {
          fail(id, 'update', lastAccepted(id), e);
        }
      }
      inFlight.delete(id);
    };
    inFlight.set(id, run());
  }

  return {
    /** Seed `lastSynced` from a cache of itself (an earlier launch's acks). */
    hydrate(entries: E[]): void {
      for (const e of entries) lastSynced.set(e.id, e);
    },

    /** The server's library, adopted as the acknowledged state. */
    async load(): Promise<E[]> {
      const entries = await api.list();
      lastSynced.clear();
      for (const e of entries) lastSynced.set(e.id, e);
      synced();
      return entries;
    },

    /** A new entry: POSTed through the per-entry queue, so a fast follow-up
     *  edit waits for the row to exist and then diffs against it. */
    create(entry: E): void {
      creating.add(entry.id);
      enqueue(entry.id, entry);
    },

    /** An edit: queued behind whatever is in flight for the entry. */
    save(entry: E): void {
      enqueue(entry.id, entry);
    },

    /** A delete, with the accepted state handed back if it fails. */
    remove(id: string): void {
      const before = lastAccepted(id);
      lastSynced.delete(id);
      recentUnclears.delete(id);
      pending.delete(id);
      synced();
      api.remove(id).catch((e) => {
        if (before && !lastSynced.has(id)) {
          lastSynced.set(id, before);
          synced();
        }
        fail(id, 'delete', before, e);
      });
    },

    /**
     * Re-reads the library and reconciles it with local state — the cheap
     * move that makes most conflicts never exist. Clean entries (local ==
     * acked) adopt the server outright; dirty ones run the same three-way
     * merge a 409 would. Either way `lastSynced` becomes the server state,
     * so the next save pushes exactly the local delta.
     */
    async refresh(current: E[]): Promise<E[]> {
      const rows = await api.list();
      const server = new Map(rows.map((e) => [e.id, e]));
      const out: E[] = [];
      for (const local of current) {
        const theirs = server.get(local.id);
        if (!theirs) {
          // Deleted on another device, or created here and not yet landed.
          if (creating.has(local.id) || !lastSynced.has(local.id)) out.push(local);
          else {
            lastSynced.delete(local.id);
          }
          continue;
        }
        server.delete(local.id);
        const base = lastAccepted(local.id);
        const clean = base && same(toSyncable(local), toSyncable(base));
        if (clean) {
          const treeChanged = !same(base!.recipe, theirs.recipe);
          lastSynced.set(local.id, theirs);
          const adopted = { ...local, ...toSyncable(theirs), version: theirs.version } as E;
          out.push(adopted);
          if (treeChanged) events.onNotice({ id: local.id, kind: 'remote_update', message: REMOTE_UPDATE, entry: adopted });
          continue;
        }
        const { merged, treeConflict } = mergeEntry(
          base ? toSyncable(base) : null,
          toSyncable(local),
          toSyncable(theirs),
          recentUnclears.get(local.id) ?? new Set()
        );
        lastSynced.set(local.id, theirs);
        const adopted = { ...local, ...merged, version: theirs.version } as E;
        out.push(adopted);
        if (treeConflict) events.onNotice({ id: local.id, kind: 'tree_conflict', message: TREE_CONFLICT, entry: adopted });
      }
      // Rows on the server and not here: created on another device.
      for (const theirs of server.values()) {
        lastSynced.set(theirs.id, theirs);
        out.push(theirs);
      }
      synced();
      return out;
    },

    lastAccepted,

    /** Resolves when every queued write has settled. For tests, and for a
     *  sign-out that should not leave a write in the air. */
    async idle(): Promise<void> {
      while (inFlight.size) await Promise.all([...inFlight.values()]);
    },

    /** Forget everything — sign-out. */
    reset(): void {
      lastSynced.clear();
      recentUnclears.clear();
      pending.clear();
      creating.clear();
    },
  };
}

export type SyncEngine<E extends SyncEntry> = ReturnType<typeof createSyncEngine<E>>;
