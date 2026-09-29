/**
 * title.ts — a recipe's title and "From" line as a PERSON types them: the
 * rename in the ⋮ menu, the title in an unsaved preview, the editor's Title
 * field, and the two optional fields beside a pasted recipe or a photo.
 *
 * One rule for all of them, so no screen can save what another refuses:
 * surrounding whitespace goes, runs of it (a pasted newline, a double space)
 * become one space, an empty title is refused, and nothing is longer than
 * TITLE_MAX. The fields that take typing carry `maxLength` from here too, so
 * the cut in `cleanTitle` is a guard for a paste, not something anyone sees.
 *
 * A title is the account's own. `withUserFields` is applied on the phone to
 * the tree an extraction returned — a fresh read and a cache hit alike — so
 * the typed title always wins, and nothing here ever reaches the extraction
 * cache, the search or another account: the cache is written by the extract
 * route before the reply, and a save only READS it (for the wording).
 *
 * The title is not one of the names the component links ride on (section
 * names and ingredient names — edits.ts `brokenComponentLinks`), so a rename
 * can never break the cooking order; title.test.ts pins that.
 */

export const TITLE_MAX = 100;
/** "From": who or where a pasted or photographed recipe came from. */
export const FROM_MAX = 80;

/** The shared tidy: surrounding whitespace off, runs of it to one space,
 *  cut to `max`. Titles, "From" lines and book names (books.ts) all use it. */
export const tidyText = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
const tidy = tidyText;

/** The title as it will be saved; "" when there is none. */
export const cleanTitle = (raw: unknown): string => tidy(raw, TITLE_MAX);

/** The "From" line as it will be saved; "" when there is none. */
export const cleanFrom = (raw: unknown): string => tidy(raw, FROM_MAX);

/** Why this title cannot be saved, in a sentence, or null when it can. */
export function titleProblem(raw: unknown): string | null {
  return cleanTitle(raw) ? null : "Give it a title to save it.";
}

/**
 * The optional fields typed beside a paste or a photo, applied to the tree
 * the extraction returned. Blank leaves the extraction's own value alone —
 * a title the model found is better than none. Never mutates.
 */
export function withUserFields<T extends { title?: string; source?: string | null }>(
  recipe: T,
  fields: { title?: string | null; from?: string | null }
): T {
  const title = cleanTitle(fields.title);
  const from = cleanFrom(fields.from);
  if (!title && !from) return recipe;
  return { ...recipe, ...(title ? { title } : {}), ...(from ? { source: from } : {}) };
}
