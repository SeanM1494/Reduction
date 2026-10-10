/**
 * books.ts — the recipe box's books, as the person owns them.
 *
 * WHAT A BOOK IS. A named, colored, ordered place a recipe sits in. Every
 * recipe is in exactly one (the page numbering and the flip depend on it).
 * An account's books are ONE versioned document (`recipe_books` on the
 * server, a single-document write queue on the phone), and a recipe names
 * its book BY ID (`recipe_placements`), never by name, so a rename cannot
 * orphan anything.
 *
 * THE DEFAULTS are today's seven meal-type books, under the ids the phone
 * already used (`breakfast` … `other`), with the same names and colors, so
 * an account that never customises sees exactly what it saw before. A
 * default book is hidden while empty; a book the person made is shown empty
 * ("Room for one more"). "Other" can be renamed and recolored and can never
 * be deleted: it is where anything without a better home goes.
 *
 * DELETING NEVER TOUCHES A RECIPE. A deleted book stays in the document as
 * a tombstone that says where its recipes went (`mergedInto`), and every
 * reader resolves a recipe's book through that chain (`resolveBookId`): a
 * live book, or — if the chain ends nowhere, or loops — Other. Other is
 * always live and a deleted book always points somewhere or nowhere, so a
 * recipe can never land in a book that does not exist, whatever two devices
 * did at once. That is the whole conflict story, and books.test.ts proves
 * it case by case.
 *
 * PURE, no dependencies beyond this package: the phone, the server and the
 * tests all call the same functions.
 */

import { primaryMealType, type MealType } from "./mealTypes";
import { tidyText } from "./title";

export interface BookDef {
  /** Stable for ever. The defaults use their old names; new ones a UUID. */
  id: string;
  name: string;
  /** One of BOOK_COLORS' hexes. */
  color: string;
  /** Shelf order, ascending; ties by createdAt, then id. */
  position: number;
  /** Epoch ms. The defaults carry 0. */
  createdAt?: number;
  /** Epoch ms when deleted, or null/absent while live. */
  deletedAt?: number | null;
  /** Where a deleted book's recipes went: a book id, or null when there was
   *  nowhere to send them (the book was empty) — those go to Other. */
  mergedInto?: string | null;
}

export const OTHER_BOOK_ID = "other";
export const MAX_BOOKS = 12;
export const BOOK_NAME_MAX = 30;
/** What a server accepts: the cap only blocks ADDING, so two devices'
 *  books merged past it are kept rather than dropped (see mergeBooks). */
export const MAX_LIVE_BOOKS_STORED = MAX_BOOKS * 2;
export const MAX_BOOK_ENTRIES = 200;

/**
 * The colors a book can be. A book is an object, like its cream pages, so
 * the color does not follow the theme — and its tab carries 11px white
 * text, so every one here is 4.5:1 or better against white, and stays
 * visible on both page backgrounds (books.test.ts computes all three). The
 * first seven are the defaults' own. Dropped when chosen (Sep 29): sage
 * (4.3:1 against white), brick and rust (too near Dinner's).
 */
export const BOOK_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Honey", hex: "#986d29" },
  { name: "Fern", hex: "#657c51" },
  { name: "Terracotta", hex: "#a94f3a" },
  { name: "Teal", hex: "#477d7b" },
  { name: "Leaf", hex: "#5a7f43" },
  { name: "Berry", hex: "#8e4f6f" },
  { name: "Slate", hex: "#6a6575" },
  { name: "Cocoa", hex: "#7a4e36" },
  { name: "Raspberry", hex: "#9b3d52" },
  { name: "Plum", hex: "#6f4a6e" },
  { name: "Caramel", hex: "#8c5a22" },
  { name: "Olive", hex: "#6b6a2c" },
];

export const colorName = (hex: string): string =>
  BOOK_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? "Custom";

/** Today's seven, exactly: ids, names, colors, order. */
export const DEFAULT_BOOKS: readonly BookDef[] = [
  { id: "breakfast", name: "Breakfast", color: "#986d29", position: 0, createdAt: 0 },
  { id: "lunch", name: "Lunch", color: "#657c51", position: 1, createdAt: 0 },
  { id: "dinner", name: "Dinner", color: "#a94f3a", position: 2, createdAt: 0 },
  { id: "apps", name: "Apps & Snacks", color: "#477d7b", position: 3, createdAt: 0 },
  { id: "salads", name: "Salads", color: "#5a7f43", position: 4, createdAt: 0 },
  { id: "desserts", name: "Desserts", color: "#8e4f6f", position: 5, createdAt: 0 },
  { id: OTHER_BOOK_ID, name: "Other", color: "#6a6575", position: 6, createdAt: 0 },
];

const DEFAULT_IDS = new Set(DEFAULT_BOOKS.map((b) => b.id));
/** A default book is hidden while empty; one the person made is not. */
export const isDefaultBook = (id: string): boolean => DEFAULT_IDS.has(id);

/** Which default book a meal type used to put a recipe in. */
export const DEFAULT_BOOK_OF_TYPE: Readonly<Record<MealType, string>> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
  snack: "apps",
  salad: "salads",
  dessert: "desserts",
  side: OTHER_BOOK_ID,
  drink: OTHER_BOOK_ID,
  baking: OTHER_BOOK_ID,
};

/** The default book for a recipe with no placement: its primary meal type's. */
export function defaultBookIdFor(mealTypes: string[] | undefined): string {
  const t = primaryMealType(mealTypes);
  return t ? DEFAULT_BOOK_OF_TYPE[t] : OTHER_BOOK_ID;
}

export const freshDefaultBooks = (): BookDef[] => DEFAULT_BOOKS.map((b) => ({ ...b }));

export const isLive = (b: BookDef): boolean => b.deletedAt == null;

const order = (a: BookDef, b: BookDef) =>
  a.position - b.position || (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The live books, in shelf order. */
export const liveBooks = (books: readonly BookDef[]): BookDef[] => books.filter(isLive).sort(order);

/**
 * The live book a recipe is in. `bookId` is its placement (null when it
 * has none — a recipe saved by the website or an older app), and then its
 * meal type's default book stands in. A deleted book sends it on to where
 * that book's recipes went; the chain ends at a live book, or at Other when
 * it leads nowhere, to a book that does not exist, or round in a loop.
 */
export function resolveBookId(books: readonly BookDef[], bookId: string | null | undefined, mealTypes?: string[]): string {
  let id: string | null | undefined = bookId || defaultBookIdFor(mealTypes);
  const seen = new Set<string>();
  while (id) {
    const b = books.find((x) => x.id === id);
    if (!b) break;
    if (isLive(b)) return b.id;
    if (seen.has(b.id)) break;
    seen.add(b.id);
    id = b.mergedInto;
  }
  return OTHER_BOOK_ID;
}

// ------------------------------------------------------------ names ------

/** A book's name as it will be saved; "" when there is none. */
export const cleanBookName = (raw: unknown): string => tidyText(raw, BOOK_NAME_MAX);

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Why this name cannot be used, in a sentence, or null when it can.
 *  `exceptId` is the book being renamed (its own name is not a clash). */
export function bookNameProblem(books: readonly BookDef[], raw: unknown, exceptId?: string): string | null {
  const name = cleanBookName(raw);
  if (!name) return "Give the book a name.";
  const clash = liveBooks(books).find((b) => b.id !== exceptId && sameName(b.name, name));
  return clash ? `You already have a book called ${clash.name}.` : null;
}

/** The first color no live book is using; round the set again when all are. */
export function nextBookColor(books: readonly BookDef[]): string {
  const used = new Set(liveBooks(books).map((b) => b.color.toLowerCase()));
  const free = BOOK_COLORS.find((c) => !used.has(c.hex.toLowerCase()));
  return (free ?? BOOK_COLORS[liveBooks(books).length % BOOK_COLORS.length]).hex;
}

// ------------------------------------------------------------- edits -----

export class BookEditError extends Error {}

export const bookLimitMessage = `You can have up to ${MAX_BOOKS} books. Delete or merge one to make room.`;

const assertColor = (hex: string) => {
  if (!BOOK_COLORS.some((c) => c.hex.toLowerCase() === hex.toLowerCase())) throw new BookEditError("Choose one of the book colors.");
};
const liveOrThrow = (books: readonly BookDef[], id: string) => {
  const b = books.find((x) => x.id === id);
  if (!b || !isLive(b)) throw new BookEditError("That book no longer exists.");
  return b;
};
const replace = (books: readonly BookDef[], id: string, patch: Partial<BookDef>): BookDef[] =>
  books.map((b) => (b.id === id ? { ...b, ...patch } : b));

export function addBook(
  books: readonly BookDef[],
  opts: { id: string; name: string; color?: string; now: number }
): BookDef[] {
  if (liveBooks(books).length >= MAX_BOOKS) throw new BookEditError(bookLimitMessage);
  if (books.some((b) => b.id === opts.id)) throw new BookEditError("That book already exists.");
  const problem = bookNameProblem(books, opts.name);
  if (problem) throw new BookEditError(problem);
  const color = opts.color ?? nextBookColor(books);
  assertColor(color);
  const last = liveBooks(books).at(-1);
  return [
    ...books,
    { id: opts.id, name: cleanBookName(opts.name), color, position: (last?.position ?? -1) + 1, createdAt: opts.now, deletedAt: null, mergedInto: null },
  ];
}

export function renameBook(books: readonly BookDef[], id: string, name: string): BookDef[] {
  liveOrThrow(books, id);
  const problem = bookNameProblem(books, name, id);
  if (problem) throw new BookEditError(problem);
  return replace(books, id, { name: cleanBookName(name) });
}

export function recolorBook(books: readonly BookDef[], id: string, color: string): BookDef[] {
  liveOrThrow(books, id);
  assertColor(color);
  return replace(books, id, { color });
}

/** One place up (-1) or down (+1) on the shelf; live books renumbered
 *  0..n-1 so the order is exact whatever it was before. */
export function moveBook(books: readonly BookDef[], id: string, dir: -1 | 1): BookDef[] {
  liveOrThrow(books, id);
  const live = liveBooks(books).map((b) => b.id);
  const i = live.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= live.length) return [...books];
  [live[i], live[j]] = [live[j], live[i]];
  const pos = new Map(live.map((x, k) => [x, k]));
  return books.map((b) => (pos.has(b.id) ? { ...b, position: pos.get(b.id)! } : b));
}

/**
 * Delete — and merge, which is the same thing: this book goes, and its
 * recipes go `into` another live book (renamed in the same step when
 * `rename` is given), or nowhere (`into: null`, for an empty book: anything
 * that ever resolves through it lands in Other). Other itself cannot go.
 * No recipe is touched: its placement still names this book, and the
 * tombstone sends it on (resolveBookId).
 */
export function deleteBook(
  books: readonly BookDef[],
  id: string,
  opts: { into: string | null; rename?: string; now: number }
): BookDef[] {
  if (id === OTHER_BOOK_ID) throw new BookEditError("Other can’t be deleted. You can rename it instead.");
  liveOrThrow(books, id);
  if (opts.into !== null) {
    if (opts.into === id) throw new BookEditError("Choose a different book for its recipes.");
    liveOrThrow(books, opts.into);
  }
  const next = replace(books, id, { deletedAt: opts.now, mergedInto: opts.into });
  // Renamed after the deletion, so the surviving book may take the name of
  // the one that is going.
  return opts.into !== null && opts.rename !== undefined ? renameBook(next, opts.into, opts.rename) : next;
}

/**
 * Delete a book and send its recipes into a NEW book made in the same step
 * ("A new book…" in the delete window). One change, so one write: the new
 * book cannot exist without the deletion, nor the deletion without it. The
 * book that is going frees its place under the cap and its name first.
 */
export function deleteIntoNewBook(
  books: readonly BookDef[],
  id: string,
  opts: { newId: string; name: string; color?: string; now: number }
): BookDef[] {
  if (id === OTHER_BOOK_ID) throw new BookEditError("Other can’t be deleted. You can rename it instead.");
  liveOrThrow(books, id);
  const gone = replace(books, id, { deletedAt: opts.now, mergedInto: opts.newId });
  return addBook(gone, { id: opts.newId, name: opts.name, color: opts.color, now: opts.now });
}

// ------------------------------------------------------------- merge -----

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Two devices' book lists, three-way against the last list both saw. The
 * server never merges; the device whose write came back 409 does, with the
 * server's list as `theirs`, and sends the result.
 *
 *  - A book only one side has is kept (made on that device).
 *  - Name, color, position: one side changed it → that side; both → mine
 *    (the later write — last change wins).
 *  - Deletion beats an edit: deleted on either side stays deleted. Both
 *    deleted it with different destinations: one side changed its mind
 *    against the base → that side; otherwise mine.
 *  - Then `repairBooks`: Other alive, names unique. Nothing is dropped to
 *    meet the cap.
 *
 * No recipe is lost by any of this: recipes are not in this document.
 */
export function mergeBooks(base: readonly BookDef[] | null, mine: readonly BookDef[], theirs: readonly BookDef[]): BookDef[] {
  const ids: string[] = [];
  for (const b of [...theirs, ...mine]) if (!ids.includes(b.id)) ids.push(b.id);
  const out: BookDef[] = [];
  for (const id of ids) {
    const m = mine.find((b) => b.id === id);
    const t = theirs.find((b) => b.id === id);
    const o = base?.find((b) => b.id === id) ?? null;
    if (!m || !t) {
      out.push({ ...(m ?? t)! });
      continue;
    }
    const pick = <K extends keyof BookDef>(k: K): BookDef[K] => {
      const cm = !o || !same(m[k], o[k]);
      const ct = !o || !same(t[k], o[k]);
      if (cm && ct) return same(m[k], t[k]) ? t[k] : m[k];
      return cm ? m[k] : t[k];
    };
    const merged: BookDef = { ...t, name: pick("name"), color: pick("color"), position: pick("position") };
    const md = !isLive(m);
    const td = !isLive(t);
    if (md || td) {
      const src = md && td ? (pick("mergedInto") === m.mergedInto ? m : t) : md ? m : t;
      merged.deletedAt = src.deletedAt;
      merged.mergedInto = src.mergedInto ?? null;
    } else {
      merged.deletedAt = null;
      merged.mergedInto = null;
    }
    out.push(merged);
  }
  return repairBooks(out);
}

/** Other always there and alive; live names unique (a later clash gets
 *  " 2", " 3"…). Anything else is left exactly as it is. */
export function repairBooks(books: readonly BookDef[]): BookDef[] {
  let out = books.map((b) => ({ ...b }));
  const other = out.find((b) => b.id === OTHER_BOOK_ID);
  if (!other) {
    const last = liveBooks(out).at(-1);
    out.push({ ...DEFAULT_BOOKS.find((b) => b.id === OTHER_BOOK_ID)!, position: (last?.position ?? -1) + 1 });
  } else if (!isLive(other)) {
    other.deletedAt = null;
    other.mergedInto = null;
  }
  const taken: string[] = [];
  for (const b of liveBooks(out)) {
    let name = cleanBookName(b.name) || "Book";
    for (let n = 2; taken.some((x) => sameName(x, name)); n++) {
      const suffix = ` ${n}`;
      name = `${cleanBookName(b.name).slice(0, BOOK_NAME_MAX - suffix.length).trim() || "Book"}${suffix}`;
    }
    taken.push(name);
    if (name !== b.name) out = out.map((x) => (x.id === b.id ? { ...x, name } : x));
  }
  return out;
}

// -------------------------------------------------------- validation -----

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** What a server checks before storing a list: shape, bounds, a live
 *  Other, clean unique live names, colors from the set, destinations that
 *  exist. Empty when it is fine. */
export function validateBooks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["books must be a list."];
  if (raw.length > MAX_BOOK_ENTRIES) return ["Too many books."];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const b of raw as BookDef[]) {
    if (!b || typeof b !== "object") return ["Each book must be an object."];
    if (typeof b.id !== "string" || !ID_RE.test(b.id)) errors.push("A book has a bad id.");
    else if (ids.has(b.id)) errors.push(`Book ${b.id} appears twice.`);
    else ids.add(b.id);
    if (typeof b.name !== "string") errors.push(`Book ${b.id} has no name.`);
    if (typeof b.color !== "string" || !BOOK_COLORS.some((c) => c.hex.toLowerCase() === b.color.toLowerCase()))
      errors.push(`Book ${b.id} has a color outside the set.`);
    if (typeof b.position !== "number" || !Number.isFinite(b.position)) errors.push(`Book ${b.id} has no position.`);
    if (b.createdAt !== undefined && (typeof b.createdAt !== "number" || !Number.isFinite(b.createdAt))) errors.push(`Book ${b.id} has a bad createdAt.`);
    if (b.deletedAt != null && (typeof b.deletedAt !== "number" || !Number.isFinite(b.deletedAt))) errors.push(`Book ${b.id} has a bad deletedAt.`);
    if (b.mergedInto != null && typeof b.mergedInto !== "string") errors.push(`Book ${b.id} has a bad destination.`);
  }
  if (errors.length) return errors;
  const books = raw as BookDef[];
  for (const b of books) if (b.mergedInto != null && (b.mergedInto === b.id || !ids.has(b.mergedInto))) errors.push(`Book ${b.id} sends its recipes nowhere that exists.`);
  const other = books.find((b) => b.id === OTHER_BOOK_ID);
  if (!other || !isLive(other)) errors.push("Other must always be there.");
  const live = liveBooks(books);
  if (live.length > MAX_LIVE_BOOKS_STORED) errors.push("Too many books.");
  const seen: string[] = [];
  for (const b of live) {
    const name = cleanBookName(b.name);
    if (!name || name !== b.name) errors.push(`Book ${b.id} needs a name of 1 to ${BOOK_NAME_MAX} characters.`);
    else if (seen.some((x) => sameName(x, name))) errors.push(`Two books are called ${name}.`);
    seen.push(name);
  }
  return errors;
}
