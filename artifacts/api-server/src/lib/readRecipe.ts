/**
 * server/lib/readRecipe.ts — a URL to a recipe tree, the way production
 * does it: our own fetch first (structured data when the page has it, the
 * page's text when not), and Anthropic's web fetch when ours fails.
 *
 * One function because three callers need the SAME path: the extract
 * route, the re-read route, and the before/after comparison script
 * (scripts/eval-extraction.ts). A comparison that ran its own copy of this
 * logic would measure the copy. Caching, the trial and the log stay in the
 * routes; this touches no database.
 *
 * NOTE, measured by the comparison rather than changed here: when OUR
 * fetch succeeds but the model's tree fails validation twice, the catch
 * below still falls through to Anthropic's fetch — up to four model calls
 * for one extraction. `fallback` says which of the two sent it there.
 */

import { sanitizeOriginal, setRecipeTotalMinutes, type OriginalRecipe } from "@workspace/recipe-model";
import type { Recipe } from "../shared/layout";
import { fetchSource } from "./fetchSource";
import { structureRecipe } from "./structureRecipe";
import { isUnreadable, structureRecipeFromUrl } from "./fetchViaClaude";
import { emptyUsage, fallbackCall, mergeUsage, type CallUsage, type ModelCallOptions } from "./extractionConfig";

export interface ReadRecipe {
  recipe: Recipe;
  attempts: number;
  repaired: string[];
  original: OriginalRecipe | null;
  /** Whose fetch produced it. */
  via: "self" | "claude";
  /** What our own fetch found, when it was ours that worked. */
  extraction?: "jsonld" | "text";
  /** Why Anthropic's fetch was used, when it was: our fetch failed, or it
   *  worked and the model's tree did not. */
  fallback?: { reason: "fetch" | "model"; message: string };
  /** Across every model call, the failed first path included. */
  usage: CallUsage;
}

export async function readRecipeAtUrl(
  url: string,
  opts: ModelCallOptions & {
    /** Told before the expensive path starts, so a failure there is still
     *  attributed to it (the extraction log's `via`). */
    onFallback?: (reason: "fetch" | "model", message: string) => void;
  } = {}
): Promise<ReadRecipe> {
  const usage = emptyUsage();
  const add = (u?: CallUsage) => mergeUsage(usage, u);

  let reason: "fetch" | "model" = "fetch";
  try {
    // Our own fetch is cheaper and gives us JSON-LD when the site has it.
    const src = await fetchSource(url);
    reason = "model";
    const out = await structureRecipe(
      {
        title: src.title,
        yieldText: src.yieldText,
        ingredients: src.ingredients,
        instructions: src.instructions,
        text: src.quality === "text" ? src.text : undefined,
        sourceUrl: url,
        // The card's own lines come with JSON-LD; only a text page needs
        // the model to copy them out (lib/prompt.ts ORIGINAL_RULES).
        askOriginal: src.quality === "text",
      },
      opts
    );
    add(out.usage);
    const recipe = out.recipe;
    recipe.source = src.siteName ?? undefined;
    recipe.image = src.image;
    // On a structured-data page the model was shown only the ingredients
    // and steps — never the page — so any total it returned is a guess
    // from step times. There, the page's own totalTime is the only source,
    // and its absence clears the model's number. On a text page the model
    // read the page itself, and its (gated) value stands.
    if (src.quality === "jsonld") setRecipeTotalMinutes(recipe, src.totalMinutes);
    return {
      recipe,
      attempts: out.attempts,
      repaired: out.repaired,
      original: src.original ?? sanitizeOriginal(out.original, "page"),
      via: "self",
      extraction: src.quality,
      usage,
    };
  } catch (selfErr) {
    // Blocked, JS-rendered, unreadable — or read, and the model's tree
    // would not validate. Let Claude fetch it instead: the request comes
    // from Anthropic's infrastructure, not this Repl.
    add((selfErr as { usage?: CallUsage }).usage);
    const message = (selfErr as Error).message;
    opts.onFallback?.(reason, message);
    console.warn(`[extract] ${reason === "fetch" ? "self-fetch" : "extraction from our fetch"} failed, using web_fetch:`, message);
    try {
      // The fallback may think harder than the first path
      // (EXTRACTION_FALLBACK_EFFORT, extractionConfig.ts).
      const out = await structureRecipeFromUrl(url, fallbackCall(opts));
      add(out.usage);
      return {
        recipe: out.recipe,
        attempts: out.attempts,
        repaired: out.repaired,
        original: sanitizeOriginal(out.original, "page"),
        via: "claude",
        fallback: { reason, message },
        usage,
      };
    } catch (claudeErr) {
      add((claudeErr as { usage?: CallUsage }).usage);
      // Anthropic's fetch came away with no recipe. When ours was refused
      // too, its error already says the site blocked us (BLOCKED_MESSAGE).
      // When OUR fetch read the page and only the tree failed, that failure
      // is the truer account of what went wrong, so it is the one reported.
      let out = claudeErr as Error & { usage?: CallUsage };
      if (isUnreadable(claudeErr) && reason === "model") out = selfErr as Error & { usage?: CallUsage };
      out.usage = usage;
      throw out;
    }
  }
}
