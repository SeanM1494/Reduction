/**
 * server/lib/original.ts — a recipe's original wording: where it is stored,
 * and the two pieces of the model's reply handling it needs.
 *
 * The shape and the gate are the model package's (`OriginalRecipe`,
 * `sanitizeOriginal`); this file is storage and plumbing. See the schema
 * comment on `extraction_originals` / `recipe_originals` for the two tables.
 *
 * EVERY FUNCTION HERE THAT TOUCHES THE DATABASE IS DECORATION. The tables
 * are hand-run DDL, so between a deploy and the CREATE TABLE they do not
 * exist; an extraction, a save or a delete must never fail because the
 * wording could not be written or read. Callers catch, log and carry on —
 * the same rule as recipe photos.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { extractionOriginals, getDb, recipeOriginals } from "@workspace/db";
import { sanitizeOriginal, type OriginalFrom, type OriginalRecipe } from "@workspace/recipe-model";

// ---------------------------------------------------------- the model ----

/**
 * Takes `original` off a parsed model reply, so the tree can be validated
 * (and, if it fails, repaired) without it. `cutOff` marks a reply the token
 * limit stopped: whatever wording made it out is kept and flagged
 * truncated — the long-recipe rule is truncate with a note, never retry.
 */
export function takeOriginal(parsed: unknown, cutOff: boolean): unknown | null {
  if (!parsed || typeof parsed !== "object" || !("original" in parsed)) return null;
  const o = parsed as { original?: unknown };
  const original = o.original;
  delete o.original;
  if (!original || typeof original !== "object") return null;
  return cutOff ? { ...(original as object), truncated: true } : original;
}

/**
 * Closes a JSON reply the token limit cut off, so what DID arrive can be
 * used: the text is cut back to the last point where every value before it
 * was complete — just after an opening bracket, just before a comma, or
 * just after a closing bracket — and the open brackets are closed.
 *
 * Only safe because `original` is asked for LAST: a cut lands in the
 * wording, the tree before it is whole, and the wording loses at most the
 * line it was in the middle of. A cut inside the tree still closes to
 * valid JSON, fails validation, and goes through the ordinary repair pass.
 */
export function closeTruncatedJson(s: string): string {
  const start = s.indexOf("{");
  if (start === -1) return s;
  const text = s.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = 0;
  let cutStack: string[] = [];
  const mark = (at: number) => {
    cut = at;
    cutStack = [...stack];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      stack.push(c);
      mark(i + 1);
    } else if (c === "}" || c === "]") {
      stack.pop();
      mark(i + 1);
      if (!stack.length) return text.slice(0, i + 1); // it was complete after all
    } else if (c === ",") mark(i);
  }
  const closers = cutStack.reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  return text.slice(0, cut).replace(/[\s,]+$/, "") + closers;
}

// ------------------------------------------------------------ storage ----

/** Written with the cached tree, under the same hash. */
export async function saveExtractionOriginal(hash: string, original: OriginalRecipe | null): Promise<void> {
  const db = getDb();
  if (!original) {
    await db.delete(extractionOriginals).where(eq(extractionOriginals.hash, hash));
    return;
  }
  await db
    .insert(extractionOriginals)
    .values({ hash, original })
    .onConflictDoUpdate({ target: extractionOriginals.hash, set: { original, createdAt: new Date() } });
}

export async function extractionOriginal(hash: string, from: OriginalFrom): Promise<OriginalRecipe | null> {
  const [row] = await getDb().select().from(extractionOriginals).where(eq(extractionOriginals.hash, hash));
  return row ? sanitizeOriginal(row.original, from) : null;
}

export async function dropExtractionOriginals(hashes: string[]): Promise<void> {
  if (!hashes.length) return;
  await getDb().delete(extractionOriginals).where(inArray(extractionOriginals.hash, hashes));
}

/** The account's copy. `undefined` = never looked; `null` = looked, none. */
export async function recipeOriginal(ownerKey: string, id: string): Promise<OriginalRecipe | null | undefined> {
  const [row] = await getDb()
    .select()
    .from(recipeOriginals)
    .where(and(eq(recipeOriginals.ownerKey, ownerKey), eq(recipeOriginals.id, id)));
  if (!row) return undefined;
  if (!row.original) return null;
  const from = (row.original as { from?: OriginalFrom }).from ?? "page";
  return sanitizeOriginal(row.original, from);
}

export async function storeRecipeOriginal(ownerKey: string, id: string, original: OriginalRecipe | null): Promise<void> {
  await getDb()
    .insert(recipeOriginals)
    .values({ ownerKey, id, original })
    .onConflictDoUpdate({
      target: [recipeOriginals.ownerKey, recipeOriginals.id],
      set: { original, createdAt: new Date() },
    });
}

/**
 * At save: copies the wording of the extraction the client names into the
 * new recipe. The key is the cache hash the extract response handed back —
 * a digest of a URL, a paste or a file the caller themself sent, so it
 * cannot name somebody else's paste without having its text. Returns
 * whether anything was copied.
 */
export async function copyExtractionOriginal(sourceKey: string, ownerKey: string, id: string): Promise<boolean> {
  const [row] = await getDb().select().from(extractionOriginals).where(eq(extractionOriginals.hash, sourceKey));
  if (!row) return false;
  const from = (row.original as { from?: OriginalFrom }).from ?? "page";
  const original = sanitizeOriginal(row.original, from);
  if (!original) return false;
  await storeRecipeOriginal(ownerKey, id, original);
  return true;
}

export async function deleteRecipeOriginal(ownerKey: string, id: string): Promise<void> {
  await getDb()
    .delete(recipeOriginals)
    .where(and(eq(recipeOriginals.ownerKey, ownerKey), eq(recipeOriginals.id, id)));
}

/** After a re-read of a page, the account's copies of it are forgotten, so
 *  the next open takes the new reading from the cache. */
export async function forgetRecipeOriginalsFor(userId: string, sourceUrl: string): Promise<void> {
  await getDb().execute(sql`
    delete from recipe_originals o using recipes r
     where o.owner_key = r.owner_key and o.id = r.id
       and r.user_id = ${userId} and r.recipe->>'sourceUrl' = ${sourceUrl}`);
}

/** Logs once per kind of failure, not once per request. */
const warned = new Set<string>();
export function warnOriginal(where: string, e: unknown): void {
  const msg = (e as Error)?.message ?? String(e);
  const key = `${where}:${msg.slice(0, 80)}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[original:${where}] ${msg} — the recipe is fine; its original wording is not stored (README "Original wording").`);
}
