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

export interface Entry {
  id: string;
  recipe: Recipe;
  /** Ids of completed ingredients and steps. */
  done: string[];
  /** Null when the source never stated a serving count. */
  servings: number | null;
  savedAt: number;
}

const LOCAL_KEY = "logic-cooking:library:v1";
const MIGRATED_KEY = `${LOCAL_KEY}.migrated`;
const OWNER_KEY_STORAGE = "logic-cooking:owner-key";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  if (!res.ok) throw new Error(body.error || `Library request failed (${res.status}).`);
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

function renameLocalKeyToMigrated(): void {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw == null) return;
    localStorage.setItem(MIGRATED_KEY, raw);
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Non-fatal: worst case the migration check runs again next load, and
    // it is idempotent (see the remoteIds check below), so nothing gets
    // duplicated.
  }
}

/** Runs before anything else can touch local data. Only migrates when the
 *  server has nothing yet, so a browser that already migrated (or never had
 *  local data) never re-sends anything. */
async function migrateLocalLibraryIfNeeded(remoteIds: Set<string>): Promise<void> {
  const local = readLocalEntries();
  if (!local || local.length === 0) return;

  const pending = local.filter((e) => !remoteIds.has(e.id));
  if (pending.length === 0) {
    // A previous attempt already got everything onto the server; this run
    // just finishes the rename.
    renameLocalKeyToMigrated();
    return;
  }

  for (const entry of pending) {
    try {
      await api("", {
        method: "POST",
        body: JSON.stringify({
          id: entry.id,
          recipe: entry.recipe,
          done: entry.done,
          servings: entry.servings,
        }),
      });
    } catch (e) {
      // Leave the local key exactly as it was — do not rename or clear it —
      // and surface the failure so the user knows their data is still only
      // local, not that it is gone.
      throw new Error(
        `Moving your saved recipes to the database stopped partway, on ` +
          `"${entry.recipe?.title ?? entry.id}" (${(e as Error).message}). ` +
          `Nothing local was changed or deleted — it will pick up where it ` +
          `left off next time you load the app.`
      );
    }
  }
  renameLocalKeyToMigrated();
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

export function saveLibrary(entries: Entry[]): void {
  const prev = lastSynced ?? new Map<string, Entry>();
  const next = new Map(entries.map((e) => [e.id, e]));

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
        }),
      }).catch((e) => console.error("[storage] could not save a new recipe:", e));
      continue;
    }
    const doneChanged = JSON.stringify(before.done) !== JSON.stringify(entry.done);
    const servingsChanged = before.servings !== entry.servings;
    if (doneChanged || servingsChanged) {
      api(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ done: entry.done, servings: entry.servings }),
      }).catch((e) => console.error("[storage] could not update a recipe:", e));
    }
  }

  for (const id of prev.keys()) {
    if (!next.has(id)) {
      api(`/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) =>
        console.error("[storage] could not delete a recipe:", e)
      );
    }
  }

  lastSynced = next;
}
