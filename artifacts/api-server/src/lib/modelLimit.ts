/**
 * lib/modelLimit.ts — when ANTHROPIC refuses the call, say so (Oct 6).
 *
 * Our own daily brakes (costBrake.ts) refuse before the call. This is the
 * other side: the call went out and Anthropic said no. Two kinds, and they
 * read the same to a person cooking but not to the operator:
 *
 *   "spend"  the account's monthly ceiling. Either the tier's cap (429 with
 *            error.details.error_code = enforced_spend_limit_reached, no
 *            retry-after) or the limit set in the Console (400,
 *            invalid_request_error, "You have reached your specified ...").
 *            Nothing works until it is raised or the month turns, so every
 *            extraction and every search fails until someone acts.
 *   "busy"   a rate limit (any other 429) or an overloaded API (529).
 *            Transient; a minute later it works.
 *
 * Before this, both came out as "Something went wrong reading that recipe."
 * and a stack trace in a log nobody reads, so the first anyone heard of a
 * spent account was a user. Now the person gets a sentence that says what
 * is happening, the log gets one loud line, and the anonymous daily counts
 * get `model_limit.spend` / `model_limit.busy`, which GET /api/admin/counters
 * shows across every instance.
 *
 * Anthropic's shapes, from the rate-limits page (read Oct 5 2026). Matched
 * on the SDK error's `status` and its parsed body, never on the class, so a
 * test can build one without the SDK.
 */
import { countEvent } from "./counters";

export type ModelLimit = "spend" | "busy";

export interface ModelLimitRefusal {
  status: number;
  body: { error: string; code: string };
}

interface ApiErrorish {
  status?: unknown;
  message?: unknown;
  error?: { error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } } };
}

/** Which limit refused this error, or null when it is not one. */
export function modelLimitOf(e: unknown): ModelLimit | null {
  if (!e || typeof e !== "object") return null;
  const err = e as ApiErrorish;
  const status = typeof err.status === "number" ? err.status : null;
  if (status === null) return null;
  const inner = err.error?.error;
  const innerMessage = typeof inner?.message === "string" ? inner.message : "";
  const message = typeof err.message === "string" ? err.message : "";
  if (status === 429) {
    return inner?.details?.error_code === "enforced_spend_limit_reached" ? "spend" : "busy";
  }
  if (status === 400 && /you have reached your specified (workspace )?api usage limits/i.test(`${innerMessage} ${message}`)) {
    return "spend";
  }
  if (status === 529) return "busy";
  return null;
}

const MESSAGES: Record<ModelLimit, string> = {
  spend: "Reading new recipes is paused for now. Recipes you have saved still work.",
  busy: "Reduction is busy right now. Try again in a minute.",
};

/** One log line per kind per instance per ten minutes: loud, not a flood. */
const LOG_EVERY_MS = 10 * 60_000;
const lastLogged = new Map<ModelLimit, number>();

/**
 * The answer to send when `e` is Anthropic refusing, or null. Logs and
 * counts as a side effect, so call it once per failed request.
 */
export function modelLimitRefusal(e: unknown, where: string, now = Date.now()): ModelLimitRefusal | null {
  const kind = modelLimitOf(e);
  if (!kind) return null;
  void countEvent(kind === "spend" ? "model_limit.spend" : "model_limit.busy");
  const last = lastLogged.get(kind);
  if (last === undefined || now - last >= LOG_EVERY_MS) {
    lastLogged.set(kind, now);
    const detail = (e as { message?: unknown }).message;
    if (kind === "spend")
      console.error(
        `[cost] ANTHROPIC SPEND LIMIT REACHED (${where}): every new recipe and search is refused until the ` +
          `limit is raised in the Claude Console (Settings > Limits / Billing) or the month turns. ${String(detail ?? "")}`
      );
    else console.warn(`[cost] Anthropic rate-limited or overloaded (${where}): ${String(detail ?? "")}`);
  }
  return { status: 503, body: { error: MESSAGES[kind], code: kind === "spend" ? "model_spend_limit" : "model_busy" } };
}

/** Test seam: the log throttle's memory. */
export function resetModelLimitLogForTests(): void {
  lastLogged.clear();
}
