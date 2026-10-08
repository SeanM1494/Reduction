/**
 * lib/shoppingList.ts — the shopping list's state and every decision about
 * it, pure (no react-native, no storage), so all of it runs under the test
 * runner. `lib/shoppingStore.ts` keeps it on disk; the screens only render.
 *
 * WHAT IS STORED IS THE CHOICES, NEVER THE ITEMS. The list holds which
 * recipes were added, at what servings, and which of their ingredients were
 * unticked; the lines on the list are derived from the recipes in the
 * library every time (recipe-model `shoppingList`). So an edit to a recipe
 * reaches the list, a recipe deleted from the library leaves it, and there
 * is no second copy of an ingredient to go stale.
 *
 * ON THIS PHONE ONLY (Sean, Oct 5): it survives closing the app, it is not
 * synced and nothing about it reaches the server. That is deliberate — the
 * market research found list SYNC is where rival apps collect one-star
 * reviews — so do not move it into the library row without that decision.
 *
 * Removing a line from the list is the same as unticking it in each
 * recipe's popup: its ingredients join those recipes' skip sets. One
 * mechanism, so reopening a recipe shows exactly what the list shows.
 */

import { shoppingList, shoppingListText, type Recipe, type ShoppingItem } from '@workspace/recipe-model';

export interface ListRecipe {
  /** The library entry. */
  entryId: string;
  /** Servings chosen in the popup; null means the recipe's own. */
  servings: number | null;
  /** Ingredient ids left off. */
  skip: string[];
}

export interface ShoppingListState {
  recipes: ListRecipe[];
  /** Merge keys of lines checked off in the store. */
  checked: string[];
}

/** What the list needs from a library entry. */
export interface ListSourceEntry {
  id: string;
  recipe: Recipe;
}

export const emptyList = (): ShoppingListState => ({ recipes: [], checked: [] });

/** Whatever came off the disk, made safe. A damaged file is an empty list,
 *  never a crash: the list is a convenience, the app is not. */
export function parseList(raw: unknown): ShoppingListState {
  if (!raw || typeof raw !== 'object') return emptyList();
  const r = raw as { recipes?: unknown; checked?: unknown };
  const recipes: ListRecipe[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.recipes)) {
    for (const x of r.recipes) {
      if (!x || typeof x !== 'object') continue;
      const { entryId, servings, skip } = x as Record<string, unknown>;
      if (typeof entryId !== 'string' || !entryId || seen.has(entryId)) continue;
      seen.add(entryId);
      recipes.push({
        entryId,
        servings: typeof servings === 'number' && Number.isFinite(servings) && servings > 0 ? servings : null,
        skip: Array.isArray(skip) ? skip.filter((s): s is string => typeof s === 'string') : [],
      });
    }
  }
  const checked = Array.isArray(r.checked) ? r.checked.filter((s): s is string => typeof s === 'string') : [];
  return { recipes, checked };
}

/** The scale an amount is rendered at: chosen servings over what the recipe
 *  makes, or exactly 1 (the identity rule in amounts.ts) when either is
 *  missing or they are equal. */
export function scaleFor(recipe: Recipe, servings: number | null): number {
  return servings && recipe.servings ? servings / recipe.servings : 1;
}

/** Add a recipe, or replace its earlier choices in place (the list keeps
 *  the order recipes were first added in). */
export function putRecipe(state: ShoppingListState, next: ListRecipe): ShoppingListState {
  const i = state.recipes.findIndex((r) => r.entryId === next.entryId);
  const recipes = i < 0 ? [...state.recipes, next] : state.recipes.map((r, j) => (j === i ? next : r));
  return { ...state, recipes };
}

export function removeRecipe(state: ShoppingListState, entryId: string): ShoppingListState {
  return { ...state, recipes: state.recipes.filter((r) => r.entryId !== entryId) };
}

export const listRecipe = (state: ShoppingListState, entryId: string) =>
  state.recipes.find((r) => r.entryId === entryId) ?? null;

export function toggleChecked(state: ShoppingListState, key: string): ShoppingListState {
  const has = state.checked.includes(key);
  return { ...state, checked: has ? state.checked.filter((k) => k !== key) : [...state.checked, key] };
}

/** Take a line off the list: each of its ingredients is skipped in the
 *  recipe it came from. A recipe left with nothing on the list goes too. */
export function removeItem(state: ShoppingListState, item: ShoppingItem, entries: ListSourceEntry[]): ShoppingListState {
  const bySource = new Map<string, string[]>();
  for (const { source, id } of item.ingredients) bySource.set(source, [...(bySource.get(source) ?? []), id]);
  let next: ShoppingListState = {
    recipes: state.recipes.map((r) => {
      const add = bySource.get(r.entryId);
      return add ? { ...r, skip: [...new Set([...r.skip, ...add])] } : r;
    }),
    checked: state.checked.filter((k) => k !== item.key),
  };
  const view = deriveList(next, entries);
  const live = new Set(view.recipes.filter((r) => r.added > 0).map((r) => r.entryId));
  next = { ...next, recipes: next.recipes.filter((r) => live.has(r.entryId) || !entries.some((e) => e.id === r.entryId)) };
  return next;
}

export interface ListView {
  /** `added` of `total` lines: "4/5 ingredients added to list" (Sean,
   *  Oct 5). Counted per recipe, before merging with other recipes. */
  recipes: { entryId: string; title: string; servings: number | null; added: number; total: number }[];
  items: (ShoppingItem & { checked: boolean })[];
}

/** The list as the screens show it. A recipe no longer in the library is
 *  left out (and stays in the state until it is next written, so a library
 *  still loading at launch does not empty the list). */
export function deriveList(state: ShoppingListState, entries: ListSourceEntry[]): ListView {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const present = state.recipes.filter((r) => byId.has(r.entryId));
  const items = shoppingList(
    present.map((r) => {
      const recipe = byId.get(r.entryId)!.recipe;
      return { id: r.entryId, recipe, scale: scaleFor(recipe, r.servings), skip: new Set(r.skip) };
    })
  );
  const checked = new Set(state.checked);
  return {
    recipes: present.map((r) => {
      const recipe = byId.get(r.entryId)!.recipe;
      const lines = popupLines(recipe, r.servings, new Set(r.skip));
      return {
        entryId: r.entryId,
        title: recipe.title,
        servings: r.servings ?? recipe.servings,
        added: lines.filter((l) => l.ticked).length,
        total: lines.length,
      };
    }),
    items: items.map((it) => ({ ...it, checked: checked.has(it.key) })),
  };
}

/** The popup's rows: this recipe alone at the chosen servings, each line
 *  ticked unless every ingredient in it is skipped. */
export function popupLines(recipe: Recipe, servings: number | null, skip: ReadonlySet<string>) {
  return shoppingList([{ id: 'popup', recipe, scale: scaleFor(recipe, servings) }]).map((it) => ({
    ...it,
    ticked: it.ingredients.some((i) => !skip.has(i.id)),
  }));
}

/** Untick or tick one popup line: all of its ingredients together. */
export function togglePopupLine(skip: ReadonlySet<string>, line: { ingredients: { id: string }[]; ticked: boolean }): Set<string> {
  const next = new Set(skip);
  for (const { id } of line.ingredients) {
    if (line.ticked) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** The servings stepper's step: an eighth of what the recipe makes, rounded,
 *  at least 1 — the same rule as the recipe's own stepper (CLAUDE.md, "steps
 *  by base/8 rounded"). */
export function servingsStep(base: number | null): number {
  return Math.max(1, Math.round((base ?? 4) / 8));
}

/** What Share sends: the lines not yet checked off, or every line when all
 *  of them are (sharing a finished list should still send something). */
export function shareText(view: ListView): string {
  const open = view.items.filter((i) => !i.checked);
  return shoppingListText(open.length ? open : view.items);
}

/** Prune check marks whose line has gone, so the stored list never grows
 *  keys nothing shows. Returns the same object when nothing changed. */
export function pruneChecked(state: ShoppingListState, view: ListView): ShoppingListState {
  const live = new Set(view.items.map((i) => i.key));
  const checked = state.checked.filter((k) => live.has(k));
  return checked.length === state.checked.length ? state : { ...state, checked };
}

/** "4/5 ingredients added to list". */
export function addedLabel(r: { added: number; total: number }): string {
  return `${r.added}/${r.total} ingredient${r.total === 1 ? '' : 's'} added to list`;
}

/** Amounts longer than this ("1 (15 oz) can") sit under the name rather
 *  than in the right-hand column, where they squeezed the name to a word
 *  on an iPhone SE. */
export const AMOUNT_COLUMN_MAX = 12;
