/**
 * src/eval/evalReport.ts — the pure half of the extraction comparison:
 * what is measured, how a source-step tag is checked, and the report.
 * The runner (evalExtraction.ts) calls the model; nothing here does, so all
 * of it is under test.
 *
 * WHAT THE COMPARISON IS FOR (Sep 25). Three changes to extraction are
 * judged one at a time on the recipes most likely to break, not the easy
 * ones:
 *
 *   A  "before"   8,000-token cap, the model's default effort, no tags —
 *                 production until 9924009
 *   B  "cap"      16,000-token cap, otherwise A — the cap alone
 *   C  "cap+low"  B with effort "low" — the effort change alone
 *   S  "now"      C with source step numbers — production since Sep 25,
 *                 tags checked for CORRECTNESS, not just presence
 *
 * A → B answers "does the cap alone stop second attempts"; B → C "does low
 * effort buy time without costing the diagram"; S "does each tag point at
 * the sentence its step came from". The retry rate is reported beside the
 * time for every config, because a second model call is both a slow
 * extraction and a failed first attempt.
 */

import type { Recipe } from "../shared/layout";
import { originalStepTexts, stepSource, type OriginalRecipe } from "@workspace/recipe-model";

export interface EvalConfig {
  key: string;
  label: string;
  effort: "low" | "medium" | "high" | null;
  maxTokens: number;
  stepSources: boolean;
}

export const CONFIGS: Record<string, EvalConfig> = {
  A: { key: "A", label: "before (8k cap, default effort)", effort: null, maxTokens: 8000, stepSources: false },
  B: { key: "B", label: "cap (16k, default effort)", effort: null, maxTokens: 16000, stepSources: false },
  C: { key: "C", label: "cap + low effort", effort: "low", maxTokens: 16000, stepSources: false },
  S: { key: "S", label: "production now (cap + low + tags)", effort: "low", maxTokens: 16000, stepSources: true },
};

export interface EvalResult {
  caseId: string;
  kind: "url" | "text" | "photo";
  config: string;
  ok: boolean;
  error?: string;
  ms: number;
  /** jsonld | text | claude (fetch) | claude (model) | paste | photo */
  path: string;
  /** Model calls made, the failed first path included. */
  calls: number;
  /** Tries on the path that produced the tree (the log's `attempts`). */
  attempts: number | null;
  stopReasons: string[];
  inputTokens: number;
  outputTokens: number;
  recipe: Recipe | null;
  original: OriginalRecipe | null;
}

/** Sonnet 5, list price per token (the claude-api reference, Sep 2026). */
export const costUsd = (input: number, output: number): number => input * 2e-6 + output * 10e-6;

// --------------------------------------------------------- tag checking --

const STOP = new Set(
  "a an and or the of to in into on onto over under with without for from by at as then until till about each it its this that these those is are be add adding cook cooking min mins minute minutes hour hours hr hrs°f°c f c large small medium".split(
    /\s+/
  )
);

/** Content words, crudely stemmed: enough to see that "fill and fold"
 *  and "Spoon the filling on, fold over" are about the same thing. */
export function words(s: string): Set<string> {
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

export interface TagRow {
  section: string;
  stepId: string;
  label: string;
  src: number | null;
  sentence: string | null;
  /** Content words the label or its ingredients share with the sentence. */
  shared: string[];
  flag: "" | "no tag" | "no wording to check" | "past the wording's cut-off" | "out of range" | "no shared words" | "before its input";
}

export interface TagCheck {
  total: number;
  tagged: number;
  rows: TagRow[];
  /** Rows that are wrong or might be — each needs a person's eye. */
  suspects: TagRow[];
}

/**
 * Checks every tag against the source step it names: in range, sharing at
 * least one content word with the step's label or its ingredients, and not
 * numbered BEFORE a step it depends on (the tree says it cannot be done
 * first; either the tag is wrong or the model restructured the source).
 * A heuristic, deliberately loud: a flagged row is for reading, and an
 * unflagged row is not proof — the report prints every row either way.
 */
export function checkTags(recipe: Recipe, original: OriginalRecipe | null): TagCheck {
  const sentences = originalStepTexts(original);
  const rows: TagRow[] = [];
  for (const section of recipe.sections) {
    const ingredients = new Map(section.ingredients.map((i) => [i.id, i]));
    const nodes = new Map(section.nodes.map((n) => [n.id, n]));
    for (const node of section.nodes) {
      const src = stepSource(node);
      const sentence = src && src >= 1 && src <= sentences.length ? sentences[src - 1] : null;
      const mine = new Set([
        ...words(node.label),
        ...node.inputs.flatMap((id) => [...words(ingredients.get(id)?.name ?? "")]),
      ]);
      const theirs = sentence ? words(sentence) : new Set<string>();
      const shared = [...mine].filter((w) => theirs.has(w));
      let flag: TagRow["flag"] = "";
      if (src === null) flag = "no tag";
      // Not the tag's fault: the reply was cut off before (or inside) the
      // wording, so there is nothing — or not enough — to check it against.
      else if (!sentences.length) flag = "no wording to check";
      else if (!sentence && original?.truncated) flag = "past the wording's cut-off";
      else if (!sentence) flag = "out of range";
      else if (!shared.length) flag = "no shared words";
      else {
        const inputSrcs = node.inputs
          .map((id) => stepSource(nodes.get(id)))
          .filter((v): v is number => v !== null);
        if (inputSrcs.some((v) => v > src)) flag = "before its input";
      }
      rows.push({ section: section.name, stepId: node.id, label: node.label, src, sentence, shared, flag });
    }
  }
  return {
    total: rows.length,
    tagged: rows.filter((r) => r.src !== null).length,
    rows,
    // Wrong or possibly wrong tags. "No wording" is reported in the row but
    // is not a suspect: it says nothing either way about the tag.
    suspects: rows.filter((r) => r.flag && r.flag !== "no tag" && r.flag !== "no wording to check" && r.flag !== "past the wording's cut-off"),
  };
}

// ------------------------------------------------------------- summary --

export interface ConfigSummary {
  config: string;
  runs: number;
  ok: number;
  avgS: number;
  maxS: number;
  over120: number;
  /** Runs that needed more than one model call — a retry or a fallback. */
  multiCall: number;
  /** Runs where some call hit the output cap. */
  hitCap: number;
  costUsd: number;
}

export function summarize(results: EvalResult[]): ConfigSummary[] {
  const by = new Map<string, EvalResult[]>();
  for (const r of results) by.set(r.config, [...(by.get(r.config) ?? []), r]);
  return [...by.entries()].map(([config, rs]) => ({
    config,
    runs: rs.length,
    ok: rs.filter((r) => r.ok).length,
    avgS: round1(rs.reduce((n, r) => n + r.ms, 0) / rs.length / 1000),
    maxS: round1(Math.max(...rs.map((r) => r.ms)) / 1000),
    over120: rs.filter((r) => r.ms > 120_000).length,
    multiCall: rs.filter((r) => r.calls > 1).length,
    hitCap: rs.filter((r) => r.stopReasons.includes("max_tokens")).length,
    costUsd: Math.round(rs.reduce((n, r) => n + costUsd(r.inputTokens, r.outputTokens), 0) * 100) / 100,
  }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The tree as indented text, for reading two configs side by side. */
export function outline(recipe: Recipe | null): string {
  if (!recipe) return "(no tree)";
  const lines: string[] = [];
  for (const s of recipe.sections) {
    lines.push(`${s.name}${s.header ? ` — ${s.header}` : ""}`);
    const ing = new Map(s.ingredients.map((i) => [i.id, i]));
    const nodes = new Map(s.nodes.map((n) => [n.id, n]));
    for (const n of s.nodes) {
      const inputs = n.inputs.map((id) => ing.get(id)?.name ?? `[${nodes.get(id)?.label ?? id}]`).join(", ");
      const tag = stepSource(n);
      const src = tag !== null ? ` (src ${tag})` : "";
      lines.push(`  ${n.label}${src} ← ${inputs}`);
    }
  }
  return lines.join("\n");
}

const counts = (r: Recipe | null) =>
  r
    ? `${r.sections.length} sec · ${r.sections.reduce((n, s) => n + s.ingredients.length, 0)} ing · ${r.sections.reduce((n, s) => n + s.nodes.length, 0)} steps`
    : "—";

// -------------------------------------------------------------- report --

export function renderMarkdown(results: EvalResult[], configs: EvalConfig[], startedAt: Date): string {
  const out: string[] = [];
  out.push(`# Extraction comparison — ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
  out.push("| config | runs | ok | avg s | max s | >120s | >1 model call | hit cap | cost |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of summarize(results)) {
    const c = configs.find((x) => x.key === s.config);
    out.push(
      `| ${s.config} ${c?.label ?? ""} | ${s.runs} | ${s.ok} | ${s.avgS} | ${s.maxS} | ${s.over120} | ${s.multiCall} | ${s.hitCap} | $${s.costUsd.toFixed(2)} |`
    );
  }
  out.push("");

  const cases = [...new Set(results.map((r) => r.caseId))];
  out.push("## Per case", "");
  out.push(`| case | ${configs.map((c) => c.key).join(" | ")} |`);
  out.push(`|---|${configs.map(() => "---").join("|")}|`);
  for (const id of cases) {
    const cells = configs.map((c) => {
      const r = results.find((x) => x.caseId === id && x.config === c.key);
      if (!r) return "";
      return r.ok
        ? `${round1(r.ms / 1000)}s · ${r.path} · ${r.calls} call${r.calls === 1 ? "" : "s"}${r.stopReasons.includes("max_tokens") ? " · CAP" : ""} · ${counts(r.recipe)}`
        : `FAILED ${round1(r.ms / 1000)}s · ${r.calls} calls · ${(r.error ?? "").slice(0, 60)}`;
    });
    out.push(`| ${id} | ${cells.join(" | ")} |`);
  }
  out.push("");

  // Source step tags: every row, suspects first.
  const tagged = results.filter((r) => r.config === "S" && r.ok && r.recipe);
  if (tagged.length) {
    out.push("## Source step tags (config S)", "");
    for (const r of tagged) {
      const check = checkTags(r.recipe!, r.original);
      out.push(
        `### ${r.caseId} — ${check.tagged}/${check.total} tagged, ${check.suspects.length} to check`,
        "",
        "| step | src | the source's sentence | shared | flag |",
        "|---|---|---|---|---|"
      );
      for (const row of [...check.suspects, ...check.rows.filter((x) => !check.suspects.includes(x))]) {
        out.push(
          `| ${row.section}: ${row.label} | ${row.src ?? "—"} | ${(row.sentence ?? "").replace(/\|/g, "/").slice(0, 110)} | ${row.shared.join(", ")} | ${row.flag} |`
        );
      }
      out.push("");
    }
  }

  // The trees, config by config, for reading what effort changed.
  out.push("## Trees", "");
  for (const id of cases) {
    out.push(`### ${id}`, "");
    for (const c of configs) {
      const r = results.find((x) => x.caseId === id && x.config === c.key);
      if (!r) continue;
      out.push(`**${c.key}** ${c.label}`, "```", r.ok ? outline(r.recipe) : `FAILED: ${r.error}`, "```");
    }
    out.push("");
  }
  return out.join("\n");
}
