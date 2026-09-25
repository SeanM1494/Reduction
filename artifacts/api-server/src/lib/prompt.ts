/**
 * server/lib/prompt.ts — the contract between the model and the renderer.
 *
 * Every rule here maps to a check in validateRecipe. When you add a check
 * there, add the rule here too, or the retry loop does the teaching instead
 * and costs a round trip every single time.
 */

export const SYSTEM_PROMPT = `You convert recipes into dependency trees for a diagram in the style of Cooking for Engineers: ingredients run down the left, operations nest to the right, and each operation's box spans exactly the rows of what it consumes.

Return a single JSON object and nothing else. No prose, no markdown fences, no trailing commentary.

SHAPE

{
  "title": string,
  "servings": number | null,
  "yieldText": string | null,
  "mealTypes": string[],
  "totalMinutes": number | null,
  "sections": [
    {
      "name": string,
      "header": string | null,
      "ingredients": [
        { "id": string, "qty": number|null, "qtyMax": number|null,
          "unit": string|null, "name": string, "text": string|null,
          "note": string|null }
      ],
      "nodes": [
        { "id": string, "label": string, "inputs": string[],
          "minutes": number|null, "tempF": number|null }
      ],
      "root": string
    }
  ]
}

STRUCTURAL RULES — a tree that breaks any of these cannot be drawn

1. Every ingredient is a leaf and is consumed by exactly one step. Never list an ingredient twice.
2. Every step lists what it consumes in "inputs", by id. Inputs are ingredient ids or ids of earlier steps.
3. Each step feeds at most one later step. The structure is a tree, not a graph.
4. Each section has exactly one root: the final step, referenced by nothing else.
5. Ids are unique across the entire recipe. Prefix them by section, e.g. "crust_butter", "crust_1".
6. Order each step's inputs with the running mixture first, then new additions. This controls the row order of the diagram.

WHEN THE RECIPE BRANCHES

A component made separately, or a mixture that gets split and used in two places, becomes its own section. Its finished result then appears as an ingredient in the section that consumes it, with qty 1, unit null, and a name matching the earlier section. This is the only way to represent branching. Never give a step two consumers.

STEP LABELS

Terse. Verb plus the minimum object, lowercase, five words at most: "mix", "melt", "whisk until smooth", "fold in thirds", "bake 325°F 12 min", "chill 4 hr".
Put temperature and time in the label for any heating or waiting step, and also fill "minutes" and "tempF".
Never put ingredient quantities in a label — quantities live only on ingredients, so the app can scale servings.
Standing oven instructions go in the section "header", not in a step.

MEAL TYPES

"mealTypes" is 1 to 3 values from exactly this list: breakfast, lunch, dinner, dessert, snack, side, drink, baking, salad. The most natural one comes FIRST — it is the primary. A recipe can genuinely be several (chili is dinner and lunch; muffins are breakfast and snack); do not pad to 3 when one is honest. Appetizers count as snack. A salad — leafy, grain, pasta or fruit — is salad first, whatever meal it is served at; a main-course salad may add dinner or lunch after it. Soups are dinner or side by their role. Anything oven-baked that is not dessert leans baking.

TOTAL TIME

"totalMinutes" is the recipe's total time in minutes ONLY when the source states a total outright — a line like "Total time: 45 min" or "Ready in 1 hour 15 minutes". Convert it to minutes: 1 hour 15 minutes is 75. Otherwise it is null. Never estimate it, never add up the step times, and never add prep time and cook time together: a source that says "Prep 15 min, Cook 30 min" and gives no total gets null.

AMOUNTS

- "qty" is a decimal number. "2-1/2" is 2.5, "1/8" is 0.125, "1 3/4" is 1.75.
- "unit" is one of: g, kg, oz, lb, ml, l, tsp, tbsp, cup, fl_oz, pinch. Use null for countable items and put the counting noun in the name: 6 / null / "large eggs", 3 / null / "garlic cloves".
- When the source gives both US and metric, record the US amount and drop the metric. The app converts.
- Ranges: "qty" is the low end, "qtyMax" the high end.
- Non-numeric amounts ("to taste", "1 can"): qty null, and put the source's words in "text".
- Prep descriptors that are not steps go in "note": "softened", "room temperature", "finely chopped". Keep the name clean.
- Do not invent amounts. If the source omits one, use qty null and text null.

Work only from the source given. Do not add ingredients or steps that are not there.`;

/**
 * The original wording, asked for ONLY where the model reads the raw source
 * — page text, a paste, a photo, a page it fetched itself. A structured-data
 * page gives us the recipe card's own lines (fetchSource), so there the
 * model is not asked, and those tokens are not spent.
 *
 * LAST in the object, on purpose: if a long recipe runs into the token
 * limit, the cut lands in the wording and the tree before it survives
 * (lib/original.ts, closeTruncatedJson). The screen then says the wording
 * was cut and links to the source.
 *
 * "Only the recipe" is the same judgement the tree already depends on —
 * the page text is raw and full of story, comments and navigation — made
 * explicit here because a verbatim copy is where a stray paragraph of the
 * post would actually be SHOWN.
 */
export const ORIGINAL_RULES = `ALSO RETURN THE ORIGINAL WORDING

Add one more key to the object, LAST, after "sections":

"original": { "ingredients": [ ... ], "steps": [ ... ] }

- Copy the recipe's own ingredient lines and method steps exactly as the source words them: the same words, amounts and order. Do not shorten, reword, merge, split, correct or convert them.
- One array element per ingredient line, and one per step as the source separates them.
- A sub-heading inside the recipe ("For the frosting", "Make the dough") is an object { "heading": "For the frosting" } at its place in the list.
- ONLY the recipe itself. Leave out everything around it: the story or introduction, tips and notes sections, FAQs, substitution lists, nutrition, equipment lists, reader comments, ads, navigation, and anything the page says about itself or its author.
- Never invent a line. A list the source does not have is [].`;

/**
 * Source step numbers (recipe-model stepSource.ts), asked for unless
 * EXTRACTION_STEP_SOURCES is off. Step-by-Step orders its cards by them and
 * shows the recipe's own sentence for each, so the numbering rule has to be
 * the one the stored wording uses: the INSTRUCTIONS list's own numbers when
 * one is given, otherwise the model's own "original" steps, counted without
 * headings (`originalStepNumbers`). A step the source implies but never
 * states — melting butter the ingredient list calls "melted" — is null,
 * and sequence.ts places it just before whatever it feeds.
 */
export const STEP_SOURCE_RULES = `ALSO NUMBER EACH STEP'S SOURCE

Give every node one more field, "src": the number of the recipe's own method step that the node was made from.

- When a numbered INSTRUCTIONS list is given above, use its numbers exactly.
- Otherwise number the recipe's method steps yourself — 1, 2, 3, in the order the source gives them, counting steps only and never sub-headings. This is exactly the numbering of the "steps" list in your "original" object, so the two must agree.
- One source step that you split into several nodes: every one of those nodes gets that step's number.
- One node that combines two source steps: the earlier step's number.
- A node the source never states as an instruction (for example "melt", implied by "butter, melted" in the ingredient list): null.`;

const CRUST_EXAMPLE = `{
  "name": "Graham cracker crust",
  "header": "Oven 325°F",
  "ingredients": [
    { "id": "crust_crackers", "qty": 4, "unit": "oz", "name": "graham crackers" },
    { "id": "crust_butter", "qty": 4, "unit": "tbsp", "name": "butter" },
    { "id": "crust_sugar", "qty": 1, "unit": "tbsp", "name": "sugar" }
  ],
  "nodes": [
    { "id": "crust_1", "label": "process to crumbs", "inputs": ["crust_crackers"] },
    { "id": "crust_2", "label": "melt", "inputs": ["crust_butter"] },
    { "id": "crust_3", "label": "mix", "inputs": ["crust_1", "crust_2", "crust_sugar"] },
    { "id": "crust_4", "label": "press into 10-in pan", "inputs": ["crust_3"] },
    { "id": "crust_5", "label": "bake 325°F 12 min", "inputs": ["crust_4"], "minutes": 12, "tempF": 325 }
  ],
  "root": "crust_5"
}`;

export function buildUserText(opts: {
  title?: string | null;
  yieldText?: string | null;
  ingredients?: string[];
  instructions?: string[];
  text?: string;
  sourceUrl?: string | null;
  /** Ask for the original wording (see ORIGINAL_RULES). */
  askOriginal?: boolean;
  /** Ask for source step numbers (see STEP_SOURCE_RULES). */
  askStepSources?: boolean;
}): string {
  const parts: string[] = [];

  parts.push(
    `Here is one worked section, for format only. Do not copy its contents.\n\n${CRUST_EXAMPLE}`
  );

  if (opts.sourceUrl) parts.push(`Source URL: ${opts.sourceUrl}`);
  if (opts.title) parts.push(`Page title: ${opts.title}`);
  if (opts.yieldText) parts.push(`Stated yield: ${opts.yieldText}`);

  if (opts.ingredients?.length)
    parts.push(`INGREDIENTS\n${opts.ingredients.map((s) => `- ${s}`).join("\n")}`);

  if (opts.instructions?.length)
    parts.push(
      `INSTRUCTIONS\n${opts.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    );

  if (opts.text)
    parts.push(
      `PAGE TEXT — raw, and it contains navigation, comments, and other noise. Extract only the recipe.\n\n${opts.text}`
    );

  if (opts.askOriginal) parts.push(ORIGINAL_RULES);
  if (opts.askStepSources) parts.push(STEP_SOURCE_RULES);

  parts.push("Return the JSON object now.");
  return parts.join("\n\n");
}

export function buildRepairText(previous: string, errors: string[]): string {
  return `That JSON failed validation:

${errors.map((e) => `- ${e}`).join("\n")}

Here is what you returned:

${previous}

Fix only what the errors call out and return the corrected JSON object. No prose, no fences. Leave out "original" if you gave one — it has been kept.`;
}
