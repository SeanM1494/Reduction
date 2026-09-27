/**
 * sourceText.ts — which of the recipe's own words belong on which card.
 *
 * A step's `src` (stepSource.ts) names the source step it came from, and the
 * extractor routinely draws SEVERAL diagram steps from one source step: a
 * crust paragraph becomes "pulse dry ingredients", "pulse to coarse crumbs"
 * and "pulse until clumping". Step-by-Step used to caption each of those
 * cards with the WHOLE paragraph, so three consecutive cards repeated it
 * word for word (Strawberry Rhubarb Bars, Sep 26, a real phone). The tree
 * already did the hard part — it knows there are three steps and what each
 * one uses — so the paragraph is divided the same way:
 *
 *   1. the source step is cut into sentences (and, when there are fewer
 *      sentences than steps, into clauses at "; " and ", then" — and, when
 *      there are still fewer, before "and" followed by a cooking verb);
 *   2. each piece is scored against each step by the content words they
 *      share — the step's label, and its ingredients' names at double
 *      weight, since "the flour, sugar and salt" is what tells three
 *      "pulse" steps apart;
 *   3. the pieces are divided into consecutive runs, one per step, in the
 *      steps' cooking order, choosing the division that scores highest.
 *      Recipes describe a paragraph's steps in the order they are done, so
 *      a run never jumps back; a piece that matches nothing (a "Set aside.")
 *      stays with the step before it.
 *
 * Nothing is rewritten: every card shows a run of the source's own words,
 * verbatim, and the runs together are the whole step. When there are fewer
 * pieces than steps, steps share the piece that fits them best and say so
 * (`shared`), rather than showing a guess as if it were exact.
 *
 * The same run is where a card's lead-in comes from (`leadIn`): "In a large
 * bowl" is the vessel the recipe names for THIS step, found in its own run.
 * It used to be keyed on the word "mix" in the label, which is why a tikka
 * masala's marinade read "In a bowl, add:" and its sear, in the same recipe,
 * just "Add:" with the pan it happens in trapped in the paragraph below.
 *
 * Pure, and in this package, because what a card says about the recipe is
 * the model's to decide and neither renderer's (CLAUDE.md, the recipe
 * model lives in exactly one place).
 */

import type { Recipe, Step } from "./layout";
import { stepSource } from "./stepSource";

export interface StepSourceText {
  /** The source's own words for this step, verbatim. */
  text: string;
  /** "In a large mixing bowl" — the vessel the text names — or null. */
  leadIn: string | null;
  /** True when the step shares its text with another step from the same
   *  source step (there were fewer pieces than steps to divide). */
  shared: boolean;
}

// ------------------------------------------------------------- words --

const STOP = new Set(
  (
    "a an and or the of to in into on onto over under with without for from by at as then until till about each " +
    "it its this that these those is are be it's your you all any some more less well just very about " +
    "min mins minute minutes hour hours hr hrs second seconds sec secs f c degree degrees " +
    "cup cups tbsp tsp tablespoon tablespoons teaspoon teaspoons oz ounce ounces lb lbs pound pounds g gram grams kg ml l " +
    "large small medium big little half whole remaining rest"
  ).split(/\s+/)
);

/** Content words, crudely stemmed: enough to see that "pulse until
 *  clumping" and "pulse until the mixture begins to clump" agree. */
export function contentWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    let w = raw;
    for (const suf of ["ing", "ed", "es", "s"]) {
      if (w.length > suf.length + 3 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
    out.add(w);
  }
  return out;
}

// ------------------------------------------------------------ pieces --

/**
 * Sentences, verbatim. A split needs a stop and then a capital (or an
 * opening quote or bracket), so "1.5 cups" and "about 2 lb." mid-sentence
 * stay whole; a page that ran two sentences together ("350 degrees F.In a
 * medium bowl") is split all the same.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s*(?=[A-Z"“‘(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence cut at "; " and before a ", then …" or " then …" clause. */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/(?<=;)\s+|(?<=,)\s+(?=then\b)|\s+(?=then\s)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The last resort, for "Whisk the egg with a splash of water and brush it
 * over each pocket" — two steps, one clause: a cut before "and" when a
 * cooking verb follows it. Only verbs, so "the flour, sugar and salt" is
 * never cut into a list's pieces.
 */
const VERBS =
  "add|arrange|bake|beat|blend|boil|bring|broil|brown|brush|chill|chop|coat|combine|cook|cool|cover|crimp|cut|dip|divide|drain|drizzle|dust|fill|flip|fold|fry|garnish|grate|grease|grill|heat|knead|layer|let|marinate|mash|melt|mix|place|pour|press|pulse|refrigerate|reduce|remove|repeat|rest|return|roast|roll|saute|sauté|scatter|scramble|season|sear|serve|set|shape|simmer|slice|spoon|spread|sprinkle|stir|stuff|strain|toast|top|toss|transfer|turn|whisk";
const AND_VERB = new RegExp(String.raw`\s+(?=and\s+(?:then\s+)?(?:${VERBS})\b)`, "i");
function andClausesOf(clause: string): string[] {
  return clause
    .split(AND_VERB)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------ vessel --

const VESSELS =
  "food processor|stand mixer|mixer bowl|mixer|blender|mixing bowl|bowl|dutch oven|stockpot|saucepan|sauté pan|saute pan|frying pan|" +
  "sheet pan|baking sheet|baking dish|baking pan|casserole dish|casserole|loaf pan|cake pan|pie dish|pie plate|springform pan|" +
  "skillet|wok|pot|pan|dish|tray|jar|slow cooker|instant pot|pressure cooker|ramekin|tin";

const VESSEL_RE = new RegExp(
  String.raw`\b(?:in|into)\s+(?:(?:a|an|the|your|one|another|same)\s+)?(?:[\w-]+\s+){0,4}?(?:${VESSELS})\b` +
    String.raw`(?:\s+of\s+(?:a|an|the|your)\s+(?:[\w-]+\s+){0,3}?(?:food processor|stand mixer|mixer|blender))?` +
    String.raw`(?:\s+(?:fitted with (?:the|a)\s+(?:[\w-]+\s+){0,2}?(?:blade|attachment|hook)))?` +
    String.raw`(?:\s+(?:over|on)\s+(?:low|medium|high|medium-high|medium-low|moderate|medium high|medium low)\s+heat)?`,
  "i"
);

/**
 * The vessel a piece of source text puts things in, as a lead-in: "In a
 * large mixing bowl", "In the bowl of a food processor fitted with the
 * metal blade", "In a non stick pan over high heat". Null when the text
 * names none — a card then says "Add:", never an invented bowl.
 */
export function leadInFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = VESSEL_RE.exec(text);
  if (!m) return null;
  const phrase = m[0].replace(/^into\b/i, "in").replace(/\s+/g, " ").trim();
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// ------------------------------------------------------------- split --

/** The words a step is known by: its label once, its ingredients twice. */
function stepBag(step: Step, names: Map<string, string>): Map<string, number> {
  const bag = new Map<string, number>();
  for (const w of contentWords(step.label ?? "")) bag.set(w, 1);
  for (const id of step.inputs ?? []) {
    const name = names.get(id);
    if (!name) continue;
    for (const w of contentWords(name)) bag.set(w, 2);
  }
  return bag;
}

const score = (piece: Set<string>, bag: Map<string, number>): number => {
  let n = 0;
  for (const w of piece) n += bag.get(w) ?? 0;
  return n;
};

/**
 * Divides `pieces` into `k` consecutive non-empty runs maximising the
 * summed score of each piece against its run's step. Ties go to the LATER
 * boundary, so a piece that matches nothing stays with the step before it.
 * Returns the run's end (exclusive) for each step.
 */
function divide(scores: number[][], k: number): number[] {
  const n = scores.length;
  const NEG = -Infinity;
  // prefix[j][i] = sum of scores[0..i) against step j
  const prefix = Array.from({ length: k }, (_, j) => {
    const p = [0];
    for (let i = 0; i < n; i++) p.push(p[i] + scores[i][j]);
    return p;
  });
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(NEG));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  best[0][0] = 0;
  for (let j = 1; j <= k; j++)
    for (let i = j; i <= n - (k - j); i++)
      for (let p = j - 1; p < i; p++) {
        if (best[j - 1][p] === NEG) continue;
        const v = best[j - 1][p] + prefix[j - 1][i] - prefix[j - 1][p];
        if (v >= best[j][i]) {
          best[j][i] = v;
          from[j][i] = p;
        }
      }
  const ends: number[] = new Array(k);
  let i = n;
  for (let j = k; j >= 1; j--) {
    ends[j - 1] = i;
    i = from[j][i];
  }
  return ends;
}

/**
 * Every tagged step's share of its source step, keyed by step id.
 *
 * `order` is the cooking order of step ids (Step-by-Step passes its cards');
 * steps from one source step are divided in that order. Steps it omits
 * follow in the recipe's own section and node order.
 */
export function sourceTextsByStep(
  recipe: Recipe,
  sourceSteps: readonly string[] | null | undefined,
  order: readonly string[] = []
): Map<string, StepSourceText> {
  const out = new Map<string, StepSourceText>();
  if (!sourceSteps?.length) return out;

  const steps = new Map<string, Step>();
  const names = new Map<string, string>();
  const natural: string[] = [];
  for (const section of recipe.sections ?? []) {
    for (const ing of section.ingredients ?? []) names.set(ing.id, ing.name ?? "");
    for (const node of section.nodes ?? []) {
      steps.set(node.id, node);
      natural.push(node.id);
    }
  }
  const seen = new Set<string>();
  const ordered = [...order, ...natural].filter((id) => steps.has(id) && !seen.has(id) && (seen.add(id), true));

  const groups = new Map<number, Step[]>();
  for (const id of ordered) {
    const step = steps.get(id)!;
    const src = stepSource(step);
    if (src === null) continue;
    groups.set(src, [...(groups.get(src) ?? []), step]);
  }

  for (const [src, group] of groups) {
    const text = sourceSteps[src - 1];
    if (!text) continue;
    if (group.length === 1) {
      out.set(group[0].id, { text, leadIn: leadInFrom(text), shared: false });
      continue;
    }

    let pieces = sentencesOf(text);
    if (pieces.length < group.length) pieces = pieces.flatMap(clausesOf);
    if (pieces.length < group.length) pieces = pieces.flatMap(andClausesOf);
    const bags = group.map((s) => stepBag(s, names));
    const scores = pieces.map((p) => {
      const words = contentWords(p);
      return bags.map((b) => score(words, b));
    });

    if (pieces.length >= group.length) {
      const ends = divide(scores, group.length);
      let start = 0;
      group.forEach((step, j) => {
        const run = pieces.slice(start, ends[j]).join(" ");
        start = ends[j];
        out.set(step.id, { text: run, leadIn: leadInFrom(run), shared: false });
      });
      continue;
    }

    // Fewer pieces than steps even at clause level: each step takes the
    // piece that fits it best, never earlier than the previous step's.
    let floor = 0;
    const chosen = group.map((_, j) => {
      let pick = floor;
      for (let i = floor; i < pieces.length; i++) if (scores[i][j] > scores[pick][j]) pick = i;
      floor = pick;
      return pick;
    });
    group.forEach((step, j) => {
      const run = pieces[chosen[j]];
      out.set(step.id, { text: run, leadIn: leadInFrom(run), shared: chosen.filter((c) => c === chosen[j]).length > 1 });
    });
  }
  return out;
}

/**
 * A long run cut to its first sentences for the card, the rest one tap
 * away. A single source step can carry a page of advice (a pizza dough's
 * knead step: the poke test, the windowpane test, what to do if it is
 * sticky), and a card read across a counter is not the place for all of
 * it. Never cuts inside a sentence; the first sentence is always shown.
 */
export function clampSourceText(text: string, maxChars = 200): { head: string; rest: string | null } {
  const sentences = sentencesOf(text);
  if (sentences.length <= 2 && text.length <= maxChars * 1.5) return { head: text, rest: null };
  let n = 1;
  let len = sentences[0].length;
  while (n < sentences.length && len + 1 + sentences[n].length <= maxChars) len += 1 + sentences[n++].length;
  if (n >= sentences.length) return { head: text, rest: null };
  return { head: sentences.slice(0, n).join(" "), rest: sentences.slice(n).join(" ") };
}
