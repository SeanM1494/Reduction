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

AMOUNTS

- "qty" is a decimal number. "2-1/2" is 2.5, "1/8" is 0.125, "1 3/4" is 1.75.
- "unit" is one of: g, kg, oz, lb, ml, l, tsp, tbsp, cup, fl_oz, pinch. Use null for countable items and put the counting noun in the name: 6 / null / "large eggs", 3 / null / "garlic cloves".
- When the source gives both US and metric, record the US amount and drop the metric. The app converts.
- Ranges: "qty" is the low end, "qtyMax" the high end.
- Non-numeric amounts ("to taste", "1 can"): qty null, and put the source's words in "text".
- Prep descriptors that are not steps go in "note": "softened", "room temperature", "finely chopped". Keep the name clean.
- Do not invent amounts. If the source omits one, use qty null and text null.

Work only from the source given. Do not add ingredients or steps that are not there.`;

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

  parts.push("Return the JSON object now.");
  return parts.join("\n\n");
}

export function buildRepairText(previous: string, errors: string[]): string {
  return `That JSON failed validation:

${errors.map((e) => `- ${e}`).join("\n")}

Here is what you returned:

${previous}

Fix only what the errors call out and return the corrected JSON object. No prose, no fences.`;
}
