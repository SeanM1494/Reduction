/**
 * server/scripts/sourceCards.ts — what each Step-by-Step card says about
 * the recipe's own words, for recipes somebody actually saved. READ ONLY.
 *
 *   node --import tsx artifacts/api-server/src/scripts/sourceCards.ts "Strawberry Rhubarb"
 *   node --import tsx artifacts/api-server/src/scripts/sourceCards.ts --all
 *   node --import tsx artifacts/api-server/src/scripts/sourceCards.ts --eval eval-out/extraction-….json
 *
 * For every card, in the order the phone deals them, it prints the lead-in
 * above the checkboxes and the "From the recipe" text — BEFORE (the whole
 * source step, which is what every card drawn from it used to show) and NOW
 * (that card's share, recipe-model sourceText.ts). It is the check that the
 * division is right on real recipes rather than on test fixtures, and it
 * needs the real library, which only the Replit workspace can reach.
 *
 * WHY IT IS SAFE AGAINST PRODUCTION. In the workspace DATABASE_URL is
 * production. This opens ONE connection, starts a `READ ONLY` transaction
 * — Postgres refuses any write inside one — runs two SELECTs, and rolls
 * back. It imports nothing that writes, and it never runs the extractor.
 * `--eval` reads a comparison report's JSON instead and touches no
 * database at all.
 */

import { readFileSync } from "node:fs";
import pg from "pg";
import {
  cardSequence,
  clampSourceText,
  originalStepTexts,
  sanitizeOriginal,
  sourceTextsByStep,
  stepSource,
  type OriginalRecipe,
} from "@workspace/recipe-model";
import type { Recipe } from "../shared/layout";

interface Item {
  title: string;
  recipe: Recipe;
  original: OriginalRecipe | null;
  order?: unknown;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function report(item: Item): { repeatsBefore: number; repeatsNow: number } {
  const { recipe } = item;
  const sourceSteps = originalStepTexts(item.original);
  const seq = cardSequence(recipe, (item.order ?? undefined) as never);
  const steps = new Map(recipe.sections.flatMap((s) => s.nodes.map((n) => [n.id, n] as const)));
  const names = new Map(recipe.sections.flatMap((s) => s.ingredients.map((i) => [i.id, i.name] as const)));
  const now = sourceTextsByStep(recipe, sourceSteps, seq.map((c) => c.stepId));

  console.log(`\n══ ${item.title} — ${seq.length} cards, ${sourceSteps.length} source steps${sourceSteps.length ? "" : " (no original wording stored: nothing is shown, before or now)"}`);
  const before = new Map<string, number>();
  const shown = new Map<string, number>();
  seq.forEach((c, i) => {
    const step = steps.get(c.stepId)!;
    const src = stepSource(step);
    const whole = src ? sourceSteps[src - 1] ?? null : null;
    const mine = now.get(c.stepId) ?? null;
    const ings = (step.inputs ?? []).map((id) => names.get(id)).filter(Boolean);
    if (whole) before.set(whole, (before.get(whole) ?? 0) + 1);
    if (mine) shown.set(mine.text, (shown.get(mine.text) ?? 0) + 1);
    console.log(`\n  ${i + 1}. ${step.label}${src ? `  (source step ${src})` : "  (no source number)"}`);
    if (ings.length) console.log(`     lead-in: "${mine?.leadIn ? `${mine.leadIn}, add` : "Add"}:"  → ${ings.join(", ")}`);
    if (!whole) return;
    console.log(`     before:  ${clip(whole, 160)}${whole.length > 160 ? `  [${whole.length} chars]` : ""}`);
    if (!mine) return;
    const { head, rest } = clampSourceText(mine.text);
    console.log(`     now:     ${rest ? `${head} …  [+ "Show the rest": ${rest.length} chars]` : mine.text}${mine.shared ? "  (shared: fewer pieces than steps)" : ""}`);
  });
  const repeats = (m: Map<string, number>) => [...m.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  const r = { repeatsBefore: repeats(before), repeatsNow: repeats(shown) };
  console.log(`\n  cards repeating another card's text: before ${r.repeatsBefore}, now ${r.repeatsNow}`);
  return r;
}

async function fromLibrary(match: string | null): Promise<Item[]> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const rows = await client.query(
      `select owner_key, id, recipe, card_order from recipes
        where removed_at is null and ($1::text is null or recipe->>'title' ilike '%' || $1 || '%')
          and exists (select 1 from jsonb_array_elements(recipe->'sections') s, jsonb_array_elements(s->'nodes') n where n ? 'src')
        order by updated_at desc nulls last limit 40`,
      [match]
    );
    const items: Item[] = [];
    for (const row of rows.rows) {
      const o = await client.query(`select original from recipe_originals where owner_key = $1 and id = $2`, [row.owner_key, row.id]);
      items.push({
        title: row.recipe?.title ?? row.id,
        recipe: row.recipe,
        original: sanitizeOriginal(o.rows[0]?.original ?? null, (o.rows[0]?.original?.from as never) ?? "page"),
        order: row.card_order,
      });
    }
    return items;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

function fromEval(file: string): Item[] {
  const results = JSON.parse(readFileSync(file, "utf8")) as { caseId: string; config: string; ok: boolean; recipe: Recipe | null; original: OriginalRecipe | null }[];
  return results
    .filter((r) => r.ok && r.recipe && r.config === "S")
    .map((r) => ({ title: `${r.recipe!.title} (${r.caseId})`, recipe: r.recipe!, original: r.original }));
}

async function main() {
  const args = process.argv.slice(2);
  const evalAt = args.indexOf("--eval");
  const items =
    evalAt >= 0 ? fromEval(args[evalAt + 1]) : await fromLibrary(args.includes("--all") ? null : args.filter((a) => !a.startsWith("--")).join(" ") || null);
  if (!items.length) {
    console.log("No saved recipe with source step numbers matched. Recipes read before Sep 25 have none, and show no source text at all.");
    return;
  }
  let before = 0;
  let now = 0;
  for (const item of items) {
    const r = report(item);
    before += r.repeatsBefore;
    now += r.repeatsNow;
  }
  console.log(`\n${items.length} recipe(s). Cards repeating another card's text: before ${before}, now ${now}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
