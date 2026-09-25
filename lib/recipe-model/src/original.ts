/**
 * original.ts — the recipe as its source worded it, beside the diagram.
 *
 * The diagram is a rewrite: terse labels, amounts pulled apart, steps
 * restructured into a tree. This is the other thing someone cooking wants
 * to check against — the ingredient lines and method steps in the source's
 * own words — kept as STRUCTURE (one element per line, sub-headings marked)
 * rather than one block of text, so it can be read at arm's length.
 *
 * WHERE IT COMES FROM (api-server, lib/original.ts on that side):
 *   - a page with schema.org JSON-LD: `recipeIngredient` and
 *     `recipeInstructions`, the recipe card's own data, never the post
 *     around it. No model involved.
 *   - everything else (a page without structured data, a paste, a photo,
 *     a page only Claude could fetch): the SAME model pass that builds the
 *     tree also copies the recipe's lines out verbatim, told to leave the
 *     story, tips, comments and everything else around the recipe behind.
 *
 * WHAT IT IS NOT: a copy of the page. Only the recipe's lines, only for the
 * account that saved it, never surfaced through search or to anyone else.
 * It is kept out of the recipe JSON on purpose — the library list returns
 * every entry's JSON on each load — and served on its own route.
 *
 * Everything that enters storage goes through `sanitizeOriginal`: it is the
 * gate for model output and for JSON-LD alike, and it is where a long
 * recipe is TRUNCATED (with `truncated: true`, which the screen turns into
 * a note and a link to the source) rather than refused or retried.
 */

export interface OriginalLine {
  text: string;
  /** A sub-heading inside a list ("For the frosting"), not an item. */
  heading?: true;
}

export type OriginalFrom = "page" | "text" | "photo";

export interface OriginalRecipe {
  ingredients: OriginalLine[];
  steps: OriginalLine[];
  /** Cut to the limits below; the rest is on the source. */
  truncated: boolean;
  /** A web page, pasted text, or a photo/PDF — what the screen calls it. */
  from: OriginalFrom;
}

export const ORIGINAL_LIMITS = {
  ingredients: 120,
  steps: 80,
  /** Per line. A real step runs to a few hundred characters; past this it
   *  is almost certainly not a step. */
  line: 1500,
  /** Everything together — a few long recipes' worth. */
  total: 24_000,
} as const;

const clean = (s: string): string =>
  s
    .replace(/<[^>]*>/g, " ") // a stray tag in JSON-LD text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

function lineOf(v: unknown): OriginalLine | null {
  if (typeof v === "string") {
    const text = clean(v);
    return text ? { text } : null;
  }
  if (v && typeof v === "object") {
    const o = v as { heading?: unknown; text?: unknown };
    if (typeof o.heading === "string") {
      const text = clean(o.heading);
      return text ? { text, heading: true } : null;
    }
    if (typeof o.text === "string") {
      const text = clean(o.text);
      if (!text) return null;
      return (o as { heading?: unknown }).heading === true ? { text, heading: true } : { text };
    }
  }
  return null;
}

/** A heading with nothing after it before the next heading or the end is
 *  noise, not structure. */
function dropEmptyHeadings(lines: OriginalLine[]): OriginalLine[] {
  return lines.filter((l, i) => !l.heading || (i + 1 < lines.length && !lines[i + 1].heading));
}

/**
 * The gate. Accepts the model's shape ({ ingredients, steps } of strings
 * and { heading } objects) and the stored shape alike; returns null when
 * nothing usable is left. `truncated` in the input is kept (the model's
 * output may have been cut off before this saw it) and set when a limit
 * cuts here.
 */
export function sanitizeOriginal(v: unknown, from: OriginalFrom): OriginalRecipe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { ingredients?: unknown; steps?: unknown; truncated?: unknown };
  let truncated = o.truncated === true;
  let budget: number = ORIGINAL_LIMITS.total;

  const take = (list: unknown, max: number): OriginalLine[] => {
    if (!Array.isArray(list)) return [];
    const out: OriginalLine[] = [];
    for (const item of list) {
      const line = lineOf(item);
      if (!line) continue;
      if (out.length >= max) {
        truncated = true;
        break;
      }
      if (line.text.length > ORIGINAL_LIMITS.line) {
        line.text = `${line.text.slice(0, ORIGINAL_LIMITS.line).trimEnd()}…`;
        truncated = true;
      }
      if (line.text.length > budget) {
        truncated = true;
        break;
      }
      budget -= line.text.length;
      out.push(line);
    }
    return dropEmptyHeadings(out);
  };

  const ingredients = take(o.ingredients, ORIGINAL_LIMITS.ingredients);
  const steps = take(o.steps, ORIGINAL_LIMITS.steps);
  if (!ingredients.some((l) => !l.heading) && !steps.some((l) => !l.heading)) return null;
  return { ingredients, steps, truncated, from };
}

/** The number each step is shown with — headings are not steps, so they
 *  get none and the count carries on across them. */
export function originalStepNumbers(steps: OriginalLine[]): Array<number | null> {
  let n = 0;
  return steps.map((l) => (l.heading ? null : ++n));
}
