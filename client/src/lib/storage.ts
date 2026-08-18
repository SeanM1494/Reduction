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
      details: Array.isArray(body.details) ? (body.details as string[]) : undefined,
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

function toEntry(row: any): Entry {
  return {
    id: row.id,
    recipe: row.recipe,
    done: row.done ?? [],
    servings: row.servings ?? null,
    mode: row.mode === "steps" ? "steps" : "diagram",
    timer: row.timer ?? null,
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
 * Pushes local changes to the server.
 *
 * `lastSynced` is the record of what the server has actually accepted, so it
 * advances per entry only when that entry's write resolves. A failure puts
 * the previous value back, which means the next save sees the difference
 * again and retries rather than assuming the write landed.
 */
export function saveLibrary(entries: Entry[]): void {
  const prev = lastSynced ?? new Map<string, Entry>();
  const next = new Map(entries.map((e) => [e.id, e]));
  // Optimistic: assume each write lands, and undo that entry on failure.
  lastSynced = new Map(next);

  /**
   * `attempted` is the exact value this request optimistically recorded. The
   * revert only happens if that value is still what `lastSynced` holds — if a
   * later save has already written something newer for this id, that request
   * owns the entry now and this stale failure must not clobber it. Without
   * the check, a slow rejected write could undo a fast successful one.
   */
  const failed = (
    id: string,
    kind: SyncFailure["kind"],
    attempted: Entry | null,
    before: Entry | null,
    e: unknown
  ) => {
    const err = e as Error & { details?: string[] };
    const current = lastSynced?.get(id) ?? null;
    if (lastSynced && current === attempted) {
      if (before) lastSynced.set(id, before);
      else lastSynced.delete(id);
    }
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
    if (!before) {
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
      }).catch((e) => failed(id, "create", entry, null, e));
      continue;
    }
    // Before the visual editor this was normally false, and the comment here
    // said so. It is now true on every keystroke-committed edit, which is why
    // RecipeView debounces before calling this rather than calling it per
    // character.
    const recipeChanged = JSON.stringify(before.recipe) !== JSON.stringify(entry.recipe);
    const doneChanged = JSON.stringify(before.done) !== JSON.stringify(entry.done);
    const servingsChanged = before.servings !== entry.servings;
    const modeChanged = before.mode !== entry.mode;
    const timerChanged = JSON.stringify(before.timer) !== JSON.stringify(entry.timer);
    if (recipeChanged || doneChanged || servingsChanged || modeChanged || timerChanged) {
      api(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(recipeChanged ? { recipe: entry.recipe } : {}),
          done: entry.done,
          servings: entry.servings,
          mode: entry.mode,
          timer: entry.timer,
        }),
      }).catch((e) => failed(id, "update", entry, before, e));
    }
  }

  for (const id of prev.keys()) {
    if (!next.has(id)) {
      const before = prev.get(id) ?? null;
      api(`/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) =>
        // A failed delete optimistically recorded "absent", so that is what
        // must still be true for the revert to be the right move.
        failed(id, "delete", null, before, e)
      );
    }
  }
}
