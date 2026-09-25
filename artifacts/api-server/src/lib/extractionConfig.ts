/**
 * server/lib/extractionConfig.ts — how hard the model thinks while it
 * extracts, and how much it may write.
 *
 * WHY THIS EXISTS (Sep 25). Extractions had begun passing the phone's
 * 120-second wait. Two levers on the model call, measured one at a time:
 *
 *   OUTPUT CAP. Sonnet 5 reasons before it answers unless told otherwise,
 *   and that reasoning counts against `max_tokens`. At 8,000 a long recipe
 *   — tree, reasoning and, on pages without structured data, the original
 *   wording — could reach the cap, and a reply cut off inside the tree
 *   costs a whole second attempt. 16,000 is well inside what a
 *   non-streaming request can carry. It is ON.
 *
 *   EFFORT. `output_config.effort` sets how much of that reasoning happens;
 *   without it the model's default applies (the most). "low" is expected
 *   to be the larger time saving, and it is the lever that can change what
 *   the diagram says. It is ON — "low" — by decision (Sep 25): measured on
 *   real extractions after it went live rather than held back for a
 *   comparison nobody could run yet (src/eval/evalExtraction.ts still runs
 *   the four configs side by side). The EXTRACTION_EFFORT secret is the
 *   switch, so going back never needs a commit: "default" restores the
 *   model's own, "medium"/"high" pick a level.
 *
 * Read per call rather than at import, so a test (or the comparison
 * script) can pass its own values and nothing caches a stale one.
 */

export type ExtractionEffort = "low" | "medium" | "high";

const EFFORTS: readonly ExtractionEffort[] = ["low", "medium", "high"];

export const EXTRACTION_MAX_TOKENS = 16_000;

/** What runs when EXTRACTION_EFFORT is unset. */
export const DEFAULT_EFFORT: ExtractionEffort = "low";

/** EXTRACTION_EFFORT as a level, or null for "the model's default"
 *  ("default"). Unset — or anything unrecognised, since a typo in a secret
 *  must not take extraction down — is DEFAULT_EFFORT. */
export function extractionEffort(env: NodeJS.ProcessEnv = process.env): ExtractionEffort | null {
  const raw = env.EXTRACTION_EFFORT?.trim().toLowerCase();
  if (raw === "default") return null;
  return EFFORTS.includes(raw as ExtractionEffort) ? (raw as ExtractionEffort) : DEFAULT_EFFORT;
}

/** The request fields for a level. SDK 0.65 predates `output_config` in its
 *  types, so callers spread this into an otherwise-typed request; the SDK
 *  sends body fields through as given. */
export function effortFields(effort: ExtractionEffort | null): Record<string, unknown> {
  return effort ? { output_config: { effort } } : {};
}

/**
 * SOURCE STEP NUMBERS (recipe-model stepSource.ts): the model tags each
 * diagram step with the number of the recipe's own step it came from, and
 * Step-by-Step orders and captions cards by it. A wrong tag reorders cards
 * away from the recipe. ON by decision (Sep 25), to be checked on real
 * extractions (the comparison's config S prints every tag against the
 * sentence it names). EXTRACTION_STEP_SOURCES=off is the switch back: the
 * prompt is then exactly what it was and any tag is stripped. Recipes
 * extracted while it was off simply have no tags and keep the old order.
 */
export function stepSourcesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|off|false|no)$/i.test(env.EXTRACTION_STEP_SOURCES?.trim() ?? "");
}

/** Options every extraction call takes: the comparison script sets them
 *  explicitly, the routes leave them to the configuration above. */
export interface ModelCallOptions {
  /** undefined = configured; null = the model's default. */
  effort?: ExtractionEffort | null;
  maxTokens?: number;
  /** undefined = configured. */
  stepSources?: boolean;
}

export function resolveCall(opts: ModelCallOptions = {}): {
  effort: ExtractionEffort | null;
  maxTokens: number;
  stepSources: boolean;
} {
  return {
    effort: opts.effort === undefined ? extractionEffort() : opts.effort,
    maxTokens: opts.maxTokens ?? EXTRACTION_MAX_TOKENS,
    stepSources: opts.stepSources ?? stepSourcesEnabled(),
  };
}

/** What a call cost, for the comparison script and the logs. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  /** One per attempt, in order: "end_turn", "max_tokens", … */
  stopReasons: string[];
}

export const emptyUsage = (): CallUsage => ({ inputTokens: 0, outputTokens: 0, stopReasons: [] });

export function addUsage(u: CallUsage, msg: { usage?: { input_tokens?: number; output_tokens?: number } | null; stop_reason?: string | null }): void {
  u.inputTokens += msg.usage?.input_tokens ?? 0;
  u.outputTokens += msg.usage?.output_tokens ?? 0;
  u.stopReasons.push(msg.stop_reason ?? "unknown");
}
