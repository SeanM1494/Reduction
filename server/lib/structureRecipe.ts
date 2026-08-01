/**
 * server/lib/structureRecipe.ts — flat recipe text (or an image/PDF) becomes a
 * validated tree, or throws with something a person can act on.
 *
 * The loop: generate, validate with the same code the renderer uses, and on
 * failure hand the model its own output plus the error list. Two attempts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserText, buildRepairText } from "./prompt";
import { validateRecipe, type Recipe } from "../../shared/layout";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8000;
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
}

export async function structureRecipe(
  input: StructureInput
): Promise<StructureResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: contentFor(input) },
  ];

  let lastErrors: string[] = [];
  let repaired: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    const raw = textFrom(msg);
    const json = unwrap(raw);

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

    const errors = validateRecipe(parsed);
    if (errors.length === 0) {
      const recipe = parsed as Recipe;
      if (input.sourceUrl) recipe.sourceUrl = input.sourceUrl;
      return { recipe, attempts: attempt, repaired };
    }

    lastErrors = errors;
    if (attempt === MAX_ATTEMPTS) break;
    repaired = errors;
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: buildRepairText(json, errors) }
    );
  }

  const err = new Error(
    `Could not build a valid diagram from that source. ${lastErrors[0] ?? ""}`
  ) as Error & { details?: string[] };
  err.details = lastErrors;
  throw err;
}
