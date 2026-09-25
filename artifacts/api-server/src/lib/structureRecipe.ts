/**
 * server/lib/structureRecipe.ts — flat recipe text (or an image/PDF) becomes a
 * validated tree, or throws with something a person can act on.
 *
 * The loop: generate, validate with the same code the renderer uses, and on
 * failure hand the model its own output plus the error list. Two attempts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserText, buildRepairText } from "./prompt";
import { validateRecipe, type Recipe } from "../shared/layout";
import { sanitizeMealTypes } from "../shared/mealTypes";
import { setRecipeTotalMinutes } from "@workspace/recipe-model";
import { closeTruncatedJson, takeOriginal } from "./original";
import { addUsage, effortFields, emptyUsage, resolveCall, type CallUsage, type ModelCallOptions } from "./extractionConfig";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not set. Add it in the Secrets tab.");
  if (!_client) _client = new Anthropic();
  return _client;
}

/** Exported so the admin preflight can test the exact model extraction uses,
 *  rather than a model that happens to work while this one is retired. */
export const MODEL = "claude-sonnet-5";
const MAX_ATTEMPTS = 2;

export interface StructureInput {
  title?: string | null;
  yieldText?: string | null;
  ingredients?: string[];
  instructions?: string[];
  text?: string;
  sourceUrl?: string | null;
  /** A photo of a page, or a PDF. Base64, no data: prefix. */
  file?: { data: string; mediaType: string };
  /** Also copy out the recipe's original wording (prompt.ts ORIGINAL_RULES).
   *  Only where the model reads the raw source; a JSON-LD page's wording
   *  comes from the page itself. */
  askOriginal?: boolean;
}

function contentFor(input: StructureInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];

  if (input.file) {
    const { data, mediaType } = input.file;
    if (mediaType === "application/pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    } else {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data,
        },
      });
    }
  }

  blocks.push({ type: "text", text: buildUserText(input) });
  return blocks;
}

/** Models sometimes wrap JSON in fences despite instructions. Take it off. */
function unwrap(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function textFrom(msg: Anthropic.Message): string {
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

export interface StructureResult {
  recipe: Recipe;
  attempts: number;
  /** Problems the repair pass fixed. Worth logging as an extraction-quality signal. */
  repaired: string[];
  /** The model's copy of the original wording, unsanitised (the route gates
   *  it with `sanitizeOriginal`), or null when not asked or not given. */
  original: unknown | null;
  /** Tokens and stop reasons across every attempt (extractionConfig.ts). */
  usage: CallUsage;
}

export async function structureRecipe(
  input: StructureInput,
  opts: ModelCallOptions = {}
): Promise<StructureResult> {
  const call = resolveCall(opts);
  const usage = emptyUsage();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: contentFor(input) },
  ];

  let lastErrors: string[] = [];
  let repaired: string[] = [];
  let original: unknown | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: call.maxTokens,
      system: SYSTEM_PROMPT,
      messages,
      ...effortFields(call.effort),
    } as Anthropic.MessageCreateParamsNonStreaming);
    addUsage(usage, msg);

    const raw = textFrom(msg);
    // A reply the token limit stopped is closed rather than thrown away:
    // the wording is asked for last, so the cut lands there (original.ts).
    const cutOff = msg.stop_reason === "max_tokens";
    const json = cutOff ? closeTruncatedJson(raw) : unwrap(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      lastErrors = [`Response was not valid JSON: ${(e as Error).message}`];
      if (attempt === MAX_ATTEMPTS) break;
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: buildRepairText(json, lastErrors) }
      );
      continue;
    }

    // The wording comes off before the tree is judged, and the first one
    // given is kept: a repair pass is told not to repeat it.
    const given = takeOriginal(parsed, cutOff);
    if (original === null) original = given;
    const tree = JSON.stringify(parsed);

    const errors = validateRecipe(parsed);
    if (errors.length === 0) {
      const recipe = parsed as Recipe;
      if (input.sourceUrl) recipe.sourceUrl = input.sourceUrl;
      // Metadata, not structure: unknowns drop rather than costing a retry
      // round trip, and an empty result renders as "untagged".
      recipe.mealTypes = sanitizeMealTypes(recipe.mealTypes);
      // A stated total time, through its gate: junk is dropped, not stored.
      setRecipeTotalMinutes(recipe, (recipe as { totalMinutes?: unknown }).totalMinutes);
      return { recipe, attempts: attempt, repaired, original: input.askOriginal ? original : null, usage };
    }

    lastErrors = errors;
    if (attempt === MAX_ATTEMPTS) break;
    repaired = errors;
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: buildRepairText(tree, errors) }
    );
  }

  const err = new Error(
    `Could not build a valid diagram from that source. ${lastErrors[0] ?? ""}`
  ) as Error & { details?: string[]; usage?: CallUsage };
  err.details = lastErrors;
  err.usage = usage;
  throw err;
}
