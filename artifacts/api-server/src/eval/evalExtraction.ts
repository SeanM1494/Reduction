/**
 * src/eval/evalExtraction.ts — the extraction comparison. Runs each case
 * through the SAME code production uses (lib/readRecipe.ts for links,
 * structureRecipe for pastes and photos) under each config in
 * evalReport.ts, and writes a report a person reads before either secret
 * is switched on.
 *
 *   node --import tsx artifacts/api-server/src/eval/evalExtraction.ts \
 *     artifacts/api-server/src/eval/cases.txt --yes
 *
 * Options: --configs A,B,C,S (default all four) · --concurrency 2 · --out eval-out
 *
 * Run it in the Replit workspace: it needs ANTHROPIC_API_KEY and the open
 * internet, which this repo's agent container has neither of. IT SPENDS
 * REAL MONEY — every case under every config is a real extraction — so it
 * prints its estimate and does nothing without --yes.
 *
 * It never touches a database. DATABASE_URL is removed before anything
 * loads, so if some path ever reached for one it would throw rather than
 * read or write production (in the workspace, DATABASE_URL IS production).
 * Nothing is cached: every run is a fresh extraction, which is the point.
 */

delete process.env.DATABASE_URL;

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { sanitizeOriginal } from "@workspace/recipe-model";
import { readRecipeAtUrl } from "../lib/readRecipe";
import { structureRecipe } from "../lib/structureRecipe";
import type { CallUsage } from "../lib/extractionConfig";
import { CONFIGS, renderMarkdown, summarize, type EvalConfig, type EvalResult } from "./evalReport";

const MAX_TEXT = 30_000; // routes/recipes.ts MAX_TEXT: a paste is clipped there, so here too
const MEDIA: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };

interface Case {
  id: string;
  kind: "url" | "text" | "photo";
  value: string;
}

function parseArgs(argv: string[]) {
  const args = { casesFile: "", configs: Object.keys(CONFIGS), yes: false, concurrency: 2, out: "eval-out" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") args.yes = true;
    else if (a === "--configs") args.configs = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("--")) args.casesFile = a;
  }
  return args;
}

function loadCases(file: string): Case[] {
  const base = dirname(resolve(file));
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((line) => {
      if (line.startsWith("text:")) {
        const p = resolve(base, line.slice(5).trim());
        return { id: line.slice(5).trim(), kind: "text" as const, value: readFileSync(p, "utf8") };
      }
      if (line.startsWith("photo:")) {
        return { id: line.slice(6).trim(), kind: "photo" as const, value: resolve(base, line.slice(6).trim()) };
      }
      return { id: line.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70), kind: "url" as const, value: line };
    });
}

async function runOne(c: Case, cfg: EvalConfig): Promise<EvalResult> {
  const opts = { effort: cfg.effort, maxTokens: cfg.maxTokens, stepSources: cfg.stepSources };
  const started = Date.now();
  const base = { caseId: c.id, kind: c.kind, config: cfg.key };
  try {
    if (c.kind === "url") {
      const r = await readRecipeAtUrl(c.value, opts);
      return {
        ...base,
        ok: true,
        ms: Date.now() - started,
        path: r.via === "self" ? (r.extraction ?? "self") : `claude (${r.fallback?.reason ?? "?"})`,
        calls: r.usage.stopReasons.length,
        attempts: r.attempts,
        stopReasons: r.usage.stopReasons,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        recipe: r.recipe,
        original: r.original,
      };
    }
    const input =
      c.kind === "text"
        ? { text: c.value.slice(0, MAX_TEXT), askOriginal: true }
        : {
            file: { data: readFileSync(c.value).toString("base64"), mediaType: MEDIA[extname(c.value).toLowerCase()] ?? "image/jpeg" },
            askOriginal: true,
          };
    const r = await structureRecipe(input, opts);
    return {
      ...base,
      ok: true,
      ms: Date.now() - started,
      path: c.kind === "text" ? "paste" : "photo",
      calls: r.usage.stopReasons.length,
      attempts: r.attempts,
      stopReasons: r.usage.stopReasons,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      recipe: r.recipe,
      original: sanitizeOriginal(r.original, c.kind === "text" ? "text" : "photo"),
    };
  } catch (e) {
    const usage = (e as { usage?: CallUsage }).usage;
    return {
      ...base,
      ok: false,
      error: (e as Error).message,
      ms: Date.now() - started,
      path: "",
      calls: usage?.stopReasons.length ?? 0,
      attempts: null,
      stopReasons: usage?.stopReasons ?? [],
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      recipe: null,
      original: null,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.casesFile) {
    console.error("usage: evalExtraction.ts <cases file> [--configs A,B,C,S] [--concurrency 2] [--out eval-out] --yes");
    process.exit(2);
  }
  const configs = args.configs.map((k) => CONFIGS[k]).filter(Boolean);
  const cases = loadCases(args.casesFile);
  const runs = cases.length * configs.length;
  // Typical extraction: 3–8k tokens in, 2–5k out; a page Anthropic fetches
  // reads up to 40k in. The upper figure also allows for retries.
  console.log(`${cases.length} cases × ${configs.length} configs (${configs.map((c) => c.key).join(", ")}) = ${runs} extractions`);
  console.log(`estimated cost: roughly $${(runs * 0.03).toFixed(2)}–$${(runs * 0.15).toFixed(2)} (Sonnet 5 at $2 / $10 per million tokens)`);
  if (!args.yes) {
    console.log("Nothing run. Add --yes to spend it.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set here — run this in the Replit workspace.");
    process.exit(2);
  }

  const startedAt = new Date();
  const results: EvalResult[] = [];
  // Cases in parallel (up to --concurrency), a case's configs one after
  // another so the times being compared ran under the same conditions.
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      for (const cfg of configs) {
        const r = await runOne(c, cfg);
        results.push(r);
        console.log(
          `${cfg.key} ${c.id}: ${r.ok ? "ok" : "FAILED"} ${(r.ms / 1000).toFixed(1)}s ${r.path} calls=${r.calls} [${r.stopReasons.join(",")}]${r.ok ? "" : ` — ${r.error}`}`
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, cases.length) }, worker));

  mkdirSync(args.out, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const md = join(args.out, `extraction-${stamp}.md`);
  writeFileSync(md, renderMarkdown(results, configs, startedAt));
  writeFileSync(join(args.out, `extraction-${stamp}.json`), JSON.stringify(results, null, 1));
  console.log("");
  console.table(summarize(results));
  console.log(`\nReport: ${md}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
