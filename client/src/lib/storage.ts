/**
 * client/src/lib/storage.ts — persistence adapter.
 *
 * Everything in the app goes through loadLibrary / saveLibrary. Storage is
 * now Postgres via /api/library, scoped by a per-browser owner key (see
 * ownerKey() below) — there is no login, so this is what keeps separate
 * browsers from seeing each other's recipes.
 *
 * loadLibrary() also runs a one-time migration the first time a browser
 * that still has the old localStorage library talks to a server that has
 * nothing yet: every local entry is POSTed up, and only once *all* of them
 * land does the local key get renamed (never deleted) to
 * "logic-cooking:library:v1.migrated". If any entry fails partway, the
 * local key is left exactly as it was and the error is thrown so the UI
 * can show it — nothing local is ever lost.
 */

import type { Recipe } from "../../../shared/layout";
import { mergeEntry, type SyncableEntry } from "../../../shared/sync";

/** Absolute end time (epoch ms), never a countdown — see StepsMode.tsx. */
export interface StepTimer {
  stepId: string;
  endsAt: number;
}

export interface Entry {
  id: string;
  recipe: Recipe;
  /** Ids of completed ingredients and steps. */
  done: string[];
  /** Null when the source never stated a serving count. */
  servings: number | null;
  /** Which view this recipe was last shown in. Remembered per recipe. */
  mode: "diagram" | "steps";
  /** The one active cooking-mode timer for this recipe, if any. */
  timer: StepTimer | null;
  /** Epoch-ms timestamps of completed cook-throughs. Server-merged by union;
   *  see shared/sync.ts. */
  cooked?: number[];
  /** -1 would-not-repeat | 0 fine | 1 favourite | null unrated. */
  rating?: number | null;
  savedAt: number;
}

const LOCAL_KEY = "logic-cooking:library:v1";
const MIGRATED_KEY = `${LOCAL_KEY}.migrated`;
const OWNER_KEY_STORAGE = "logic-cooking:owner-key";
/** Which user id this browser's anonymous key has been handed to, if any. */
const OWNER_KEY_CLAIMED = `${OWNER_KEY_STORAGE}.claimed`;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Id for a newly saved recipe.
 *
 * These used to be `r${Date.now()}`, which is only unique within one browser
 * within one millisecond. That was survivable while rows were keyed by
 * (owner_key, id) and an owner was a single browser — but accounts change
 * that: merging two anonymous libraries into one user puts ids from different
 * browsers into the same key space, where two saves that happened to land in
 * the same millisecond collide, and the collision resolves by dropping
 * someone's recipe.
 *
 * So new saves get a UUID. Existing `r…` ids are left exactly as they are —
 * they are already unique within their own owner, which is all they ever had
 * to be, and rewriting live primary keys to fix a future problem is a worse
 * risk than the one it avoids.
 */
export function newEntryId(): string {
  return randomId();
}

/**
 * Ownership without accounts: a random id generated once per browser and
 * sent as X-Owner-Key on every request. Not security — just what keeps
 * browsers from seeing each other's recipes (see server/routes/library.ts).
 */
function ownerKey(): string {
  try {
    let key = localStorage.getItem(OWNER_KEY_STORAGE);
    if (!key) {
      key = randomId();
      localStorage.setItem(OWNER_KEY_STORAGE, key);
    }
    return key;
  } catch {
    // Private browsing or a full quota — the session still works, it just
    // won't persist across reloads.
    return `session-${randomId()}`;
  }
}

/** This browser's anonymous key, for the claim call. */
export function currentOwnerKey(): string {
  return ownerKey();
}

/**
 * The user id this browser's key has already been handed to, or null.
 *
 * Marked, never deleted. The key stays put permanently: it is what a failed
 * claim is retried from, what keeps anonymous rows visible until a claim
 * actually succeeds, and what a second device presents on a later login. See
 * the long comment in server/lib/claim.ts before "tidying" it away.
 */
export function ownerKeyClaimedBy(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY_CLAIMED);
  } catch {
    return null;
  }
}

export function markOwnerKeyClaimed(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY_CLAIMED, userId);
  } catch {
    // Worst case the claim runs again next load and reports nothing to move.
  }
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/library${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Key": ownerKey(),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `details` is validateRecipe's own list of problems, written to be read
    // by a person. Dropping it here would leave the editor able to say only
    // "that failed", which is the least useful true thing it could say.
    throw Object.assign(new Error(body.error || `Library request failed (${res.status}).`), {
      status: res.status,
      code: typeof body.code === "string" ? body.code : undefined,
      details: Array.isArray(body.details) ? (body.details as string[]) : undefined,
      // A 409 carries the server's current row so conflict resolution costs
      // one round trip, not two. Without this the merge path cannot engage
      // and every conflict degrades to a sync failure — which is exactly what
      // the first two-device test run demonstrated.
      entry: body.entry,
    });
  }
  return body;
}

function readLocalEntries(): Entry[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Has the one-time migration already run in this browser?
 *
 * This is the marker, and it is checked before the local key is read at all.
 * Testing "has the local key gone?" instead — which is what this used to do —
 * makes the migration re-runnable forever the moment removing that key fails,
 * and it fails quietly in private browsing and on a full quota.
 *
 * That mattered more than it sounds. migrateLocalLibraryIfNeeded only runs
 * when the server returns an empty library, which is precisely the state left
 * behind by cleanupSeedRecipes deleting the retired cheesecake seed on boot.
 * So a browser still carrying the pre-Postgres local library would re-upload
 * that seed every time the server had just removed it: boot deletes the row,
 * the next load puts it back, and the landing page and the library took turns
 * appearing for the same person at the same URL. Once the migration is marked
 * done, it never reads that key again and the row stays deleted.
 */
function migrationAlreadyRan(): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY) !== null;
  } catch {
    // No storage to consult means no local library to migrate either.
    return true;
  }
}

/** Records the migration as done, keeping the local data under the migrated
 *  key rather than deleting it. The marker is written *before* the original
 *  is removed, so a failure to remove can never re-arm the migration. */
function markMigrated(): void {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    localStorage.setItem(MIGRATED_KEY, raw ?? "[]");
    if (raw != null) localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Storage refused the write. The migration still succeeded server-side;
    // worst case it is attempted once more next load, and every entry now
    // conflicts, which is treated as already-migrated below.
  }
}

/**
 * Moves a pre-Postgres localStorage library onto the server, exactly once.
 *
 * Runs only when the server has nothing yet, and only when the marker above
 * says it has never run. A partial failure leaves everything local untouched
 * and throws, so the user is told their data is still only in this browser —
 * that half is deliberate and unchanged.
 */
async function migrateLocalLibraryIfNeeded(remoteIds: Set<string>): Promise<void> {
  if (migrationAlreadyRan()) return;

  const local = readLocalEntries();
  if (!local || local.length === 0) {
    // Nothing to move, but record that this browser is done so the question
    // is never asked again.
    markMigrated();
    return;
  }

  const pending = local.filter((e) => !remoteIds.has(e.id));

  for (const entry of pending) {
    try {
      await api("", {
        method: "POST",
        body: JSON.stringify({
          id: entry.id,
          recipe: entry.recipe,
          done: entry.done,
          servings: entry.servings,
          // Old local entries predate mode/timer — start fresh in Diagram.
          mode: entry.mode ?? "diagram",
          timer: entry.timer ?? null,
        }),
      });
    } catch (e) {
      // A 409 means the server already holds a row with this id, which is
      // this entry already migrated — the success case, not a failure. Left
      // as an error it would abort the run, the marker would never be set,
      // and the whole migration would retry on every empty library forever.
      if (/already exists/i.test((e as Error).message)) continue;

      // Anything else: leave the local key exactly as it was — do not mark,
      // do not clear — and surface it so the user knows their data is still
      // only local, not that it is gone.
      throw new Error(
        `Moving your saved recipes to the database stopped partway, on ` +
          `"${entry.recipe?.title ?? entry.id}" (${(e as Error).message}). ` +
          `Nothing local was changed or deleted — it will pick up where it ` +
          `left off next time you load the app.`
      );
    }
  }
  markMigrated();
}

// Snapshot of what the server last confirmed, so saveLibrary() can send only
// the create/update/delete calls a change actually needs instead of
// replacing the whole library on every save.
let lastSynced: Map<string, Entry> | null = null;

/**
 * The server's version token per entry, handed back as `ifVersion` on every
 * PATCH so a write from stale state is detected (409) instead of clobbering.
 * Server-owned: only ever set from a response.
 */
const versions = new Map<string, number>();

/**
 * Ids this device explicitly un-checked since its last successful sync.
 * They exist to answer one question during a 409 merge: "does the other
 * side's set contain this id because they did it, or because they are stale
 * from before I un-did it?" Session-local on purpose — the window they must
 * survive is uncheck-to-next-sync, not forever.
 */
const recentUnclears = new Map<string, Set<string>>();

/**
 * One in-flight write per entry, latest state queued behind it. Without
 * this, cooking taps would race their own writes: tap 2's PATCH carries
 * tap 1's ifVersion, 409s against tap 1's own committed write, and every
 * fast sequence pays a pointless conflict round trip.
 */
const inFlight = new Map<string, Promise<void>>();
const pendingEntry = new Map<string, Entry>();

function toEntry(row: any): Entry {
  if (typeof row.version === "number") versions.set(row.id, row.version);
  return {
    id: row.id,
    recipe: row.recipe,
    done: row.done ?? [],
    servings: row.servings ?? null,
    mode: row.mode === "steps" ? "steps" : "diagram",
    timer: row.timer ?? null,
    cooked: Array.isArray(row.cooked) ? row.cooked : [],
    rating: typeof row.rating === "number" ? row.rating : null,
    savedAt: row.savedAt ?? Date.now(),
  };
}

export async function loadLibrary(): Promise<Entry[]> {
  const first = await api("", { method: "GET" });
  let entries: Entry[] = (first.entries ?? []).map(toEntry);

  if (entries.length === 0) {
    // migrateLocalLibraryIfNeeded reads local data before doing anything
    // else, and only ever renames the key on full success — see its
    // comment above for the failure behavior.
    await migrateLocalLibraryIfNeeded(new Set(entries.map((e) => e.id)));
    const after = await api("", { method: "GET" });
    entries = (after.entries ?? []).map(toEntry);
  }

  lastSynced = new Map(entries.map((e) => [e.id, e]));
  return entries;
}

/**
 * A write that the server refused or never received.
 *
 * These used to go to console.error and nowhere else, while `lastSynced` was
 * advanced regardless — so a rejected edit was both invisible and never
 * retried. That was survivable while the JSON editor was the only thing that
 * could change a stored tree, because it validated before saving and a 422
 * was close to unreachable. The visual editor writes on every change, so the
 * failure is reachable, and an edit that silently disappears is the worst
 * outcome this file can produce.
 */
export interface SyncFailure {
  id: string;
  kind: "create" | "update" | "delete";
  message: string;
  /** validateRecipe's problems, when the server rejected a tree. */
  details?: string[];
  /** The last version the server actually accepted, for the caller to roll
   *  back to. Null when the entry has never been stored. */
  accepted: Entry | null;
}

type SyncFailureHandler = (failure: SyncFailure) => void;
const syncFailureHandlers = new Set<SyncFailureHandler>();

/** Subscribe to write failures. Returns an unsubscribe. */
export function onSyncFailure(handler: SyncFailureHandler): () => void {
  syncFailureHandlers.add(handler);
  return () => syncFailureHandlers.delete(handler);
}

function reportSyncFailure(failure: SyncFailure): void {
  console.error(`[storage] ${failure.kind} failed for ${failure.id}:`, failure.message);
  for (const handler of syncFailureHandlers) {
    try {
      handler(failure);
    } catch (e) {
      console.error("[storage] a sync-failure handler threw:", e);
    }
  }
}

/** The last version of an entry the server confirmed it stored. This is what
 *  a failed edit rolls back to, so it is never a guess. */
export function lastAcceptedEntry(id: string): Entry | null {
  return lastSynced?.get(id) ?? null;
}

/**
 * Something worth telling the user that is not a failure: a conflict was
 * resolved and the resolution has a loser. The one that matters is
 * `tree_conflict` — my edit replaced someone else's — because it is the only
 * merge rule that can discard real work rather than override a preference.
 * `remote_update` fires when a refetch adopts changes made on another device
 * while this one was clean, so the person whose edit lost also finds out.
 */
export interface SyncNotice {
  id: string;
  kind: "tree_conflict" | "remote_update";
  message: string;
  entry: Entry;
}

type SyncNoticeHandler = (notice: SyncNotice) => void;
const syncNoticeHandlers = new Set<SyncNoticeHandler>();

export function onSyncNotice(handler: SyncNoticeHandler): () => void {
  syncNoticeHandlers.add(handler);
  return () => syncNoticeHandlers.delete(handler);
}

function reportSyncNotice(notice: SyncNotice): void {
  for (const handler of syncNoticeHandlers) {
    try {
      handler(notice);
    } catch (e) {
      console.error("[storage] a sync-notice handler threw:", e);
    }
  }
}

const toSyncable = (e: Entry): SyncableEntry => ({
  recipe: e.recipe,
  done: e.done,
  servings: e.servings,
  mode: e.mode,
  timer: e.timer,
  cooked: e.cooked ?? [],
  rating: e.rating ?? null,
});

/** What actually goes on the wire for an update: only the fields that
 *  changed against `base`, plus the version this write was computed from.
 *  Sending unchanged fields is how a stale device used to clobber a fresh
 *  one — a mode tap carried yesterday's `done` with it. */
function buildPatch(base: Entry | null, entry: Entry): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const changed = (k: keyof Entry) =>
    !base || JSON.stringify(base[k]) !== JSON.stringify(entry[k]);
  if (changed("recipe")) body.recipe = entry.recipe;
  if (changed("done")) body.done = entry.done;
  if (changed("servings")) body.servings = entry.servings;
  if (changed("mode")) body.mode = entry.mode;
  if (changed("timer")) body.timer = entry.timer;
  if (changed("cooked")) body.cooked = entry.cooked ?? [];
  if (changed("rating")) body.rating = entry.rating ?? null;
  if (Object.keys(body).length === 0) return null;
  const v = versions.get(entry.id);
  if (v !== undefined) body.ifVersion = v;
  return body;
}

/** Record ids the user just un-checked, so a 409 merge can tell "they did
 *  it" apart from "they are stale from before I un-did it". */
function trackUnclears(id: string, base: Entry | null, entry: Entry): void {
  if (!base) return;
  const now = new Set(entry.done);
  let set = recentUnclears.get(id);
  for (const doneId of base.done) {
    if (now.has(doneId)) continue;
    if (!set) recentUnclears.set(id, (set = new Set()));
    set.add(doneId);
  }
  // Re-checked ids come off the tombstone list — the user changed their mind.
  if (set) for (const t of [...set]) if (now.has(t)) set.delete(t);
}

/** How many times one logical write will follow a 409 with a merge before
 *  giving up. Each retry starts from fresher server state, so two devices
 *  converge in one hop; three covers a third device landing mid-merge. */
const MAX_CONFLICT_RETRIES = 3;

async function pushUpdate(id: string, first: Entry): Promise<void> {
  let entry = first;
  let attempt = 0;

  while (true) {
    const base = lastAcceptedEntry(id);
    trackUnclears(id, base, entry);
    const body = buildPatch(base, entry);
    if (body === null) return;

    try {
      const res = await api(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const acked = toEntry(res.entry);
      lastSynced?.set(id, acked);
      // The server now knows about the unchecks; the tombstones have done
      // their job for everything the ack covers.
      recentUnclears.delete(id);
      return;
    } catch (e) {
      const err = e as Error & { status?: number; code?: string; entry?: unknown };
      if (err.status === 409 && err.entry && attempt < MAX_CONFLICT_RETRIES) {
        attempt++;
        const theirs = toEntry(err.entry);
        const { merged, treeConflict } = mergeEntry(
          base ? toSyncable(base) : null,
          toSyncable(entry),
          toSyncable(theirs),
          recentUnclears.get(id) ?? new Set()
        );
        entry = { ...entry, ...merged };
        // The merge is now this device's local truth too, or the next save
        // would immediately try to un-merge it.
        lastSynced?.set(id, theirs);
        applyMergedLocally?.(entry);
        if (treeConflict) {
          reportSyncNotice({
            id,
            kind: "tree_conflict",
            message:
              "This recipe was edited on another device at the same time. Your edit was kept.",
            entry,
          });
        }
        continue;
      }
      throw e;
    }
  }
}

/**
 * App's hook for adopting state that changed underneath it — a 409 merge or
 * a focus refetch. Storage cannot reach React state on its own, and leaving
 * the merge only in lastSynced would make the screen disagree with what the
 * next save pushes.
 */
let applyMergedLocally: ((entry: Entry) => void) | null = null;
export function onEntryReplaced(handler: (entry: Entry) => void): () => void {
  applyMergedLocally = handler;
  return () => {
    if (applyMergedLocally === handler) applyMergedLocally = null;
  };
}

/** Serialize writes per entry: one in flight, the newest state queued. */
function enqueueUpdate(id: string, entry: Entry, onError: (e: unknown) => void): void {
  pendingEntry.set(id, entry);
  if (inFlight.has(id)) return;
  const run = async (): Promise<void> => {
    while (pendingEntry.has(id)) {
      const nextUp = pendingEntry.get(id)!;
      pendingEntry.delete(id);
      try {
        await pushUpdate(id, nextUp);
      } catch (e) {
        onError(e);
      }
    }
    inFlight.delete(id);
  };
  inFlight.set(id, run());
}

/**
 * Pushes local changes to the server.
 *
 * `lastSynced` is the record of what the server has actually accepted, so it
 * advances per entry only when that entry's write resolves — inside
 * pushUpdate for updates, in the POST handler for creates. A failure reports
 * through onSyncFailure with the last accepted state to roll back to.
 */
export function saveLibrary(entries: Entry[]): void {
  const prev = lastSynced ?? new Map<string, Entry>();
  const next = new Map(entries.map((e) => [e.id, e]));

  const failed = (id: string, kind: SyncFailure["kind"], before: Entry | null, e: unknown) => {
    const err = e as Error & { details?: string[] };
    reportSyncFailure({
      id,
      kind,
      message: err.message,
      details: err.details,
      accepted: before,
    });
  };

  for (const [id, entry] of next) {
    const before = prev.get(id);
    if (!before && !versions.has(id)) {
      // Optimistically acked so a fast follow-up diffs against this create;
      // reverted on failure so the next save retries the POST.
      lastSynced = lastSynced ?? new Map();
      lastSynced.set(id, entry);
      api("", {
        method: "POST",
        body: JSON.stringify({
          id: entry.id,
          recipe: entry.recipe,
          done: entry.done,
          servings: entry.servings,
          mode: entry.mode,
          timer: entry.timer,
        }),
      })
        .then((res) => {
          if (res?.entry) lastSynced?.set(id, toEntry(res.entry));
        })
        .catch((e) => {
          if (lastSynced?.get(id) === entry) lastSynced.delete(id);
          failed(id, "create", null, e);
        });
      continue;
    }
    enqueueUpdate(id, entry, (e) => failed(id, "update", lastAcceptedEntry(id), e));
  }

  for (const id of prev.keys()) {
    if (!next.has(id)) {
      const before = prev.get(id) ?? null;
      lastSynced?.delete(id);
      versions.delete(id);
      recentUnclears.delete(id);
      api(`/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => {
        if (before && lastSynced && !lastSynced.has(id)) lastSynced.set(id, before);
        failed(id, "delete", before, e);
      });
    }
  }
}

/**
 * Re-reads the library and reconciles it with local state — the cheap move
 * that makes most conflicts never exist. Called on window focus: the laptop
 * that comes back to the foreground learns about tonight's phone cooking
 * BEFORE its next write, instead of colliding with it.
 *
 * Clean entries (local == acked) adopt the server state outright; dirty ones
 * run the same three-way merge a 409 would. Either way `lastSynced` becomes
 * the server state, so the next save pushes exactly the local delta.
 */
export async function refreshLibrary(current: Entry[]): Promise<Entry[]> {
  const res = await api("", { method: "GET" });
  const server = new Map<string, Entry>((res.entries ?? []).map((r: any) => {
    const e = toEntry(r);
    return [e.id, e] as [string, Entry];
  }));

  const out: Entry[] = [];
  for (const local of current) {
    const theirs = server.get(local.id);
    if (!theirs) {
      // Deleted on another device, or created here and not yet landed. If we
      // have no acked version it is the latter — keep it, the POST is on its
      // way. Otherwise the deletion wins.
      if (!versions.has(local.id)) out.push(local);
      continue;
    }
    server.delete(local.id);
    const base = lastAcceptedEntry(local.id);
    const clean = base && JSON.stringify(toSyncable(local)) === JSON.stringify(toSyncable(base));
    if (clean) {
      const treeChanged =
        JSON.stringify(base!.recipe) !== JSON.stringify(theirs.recipe);
      lastSynced?.set(local.id, theirs);
      out.push({ ...local, ...toSyncable(theirs) });
      if (treeChanged) {
        reportSyncNotice({
          id: local.id,
          kind: "remote_update",
          message: "This recipe was changed on another device.",
          entry: { ...local, ...toSyncable(theirs) },
        });
      }
      continue;
    }
    const { merged, treeConflict } = mergeEntry(
      base ? toSyncable(base) : null,
      toSyncable(local),
      toSyncable(theirs),
      recentUnclears.get(local.id) ?? new Set()
    );
    lastSynced?.set(local.id, theirs);
    const adopted = { ...local, ...merged };
    out.push(adopted);
    if (treeConflict) {
      reportSyncNotice({
        id: local.id,
        kind: "tree_conflict",
        message:
          "This recipe was edited on another device at the same time. Your edit was kept.",
        entry: adopted,
      });
    }
  }
  // Rows that exist on the server and not locally: created on another device.
  for (const theirs of server.values()) out.push(theirs);
  return out;
}

