/**
 * client/src/lib/api.ts — every import path hits the same Express route.
 */

import type { Recipe } from "../../../shared/layout";

interface ExtractResponse {
  recipe: Recipe;
  meta: {
    cached: boolean;
    source: "url" | "text" | "file";
    extraction?: "jsonld" | "text";
    attempts?: number;
    repaired?: string[];
  };
}

/** The extract response. `trialRecipeId` is present only for a signed-out
 *  visitor spending their free extraction — it is the id the server parked
 *  the recipe under, and the id the account will find it at after sign-up. */
export interface ExtractResult {
  recipe: Recipe;
  meta?: unknown;
  trialRecipeId?: string;
}

/** Ask the server to read a page again, replacing what it had cached.
 *  Signed in only, and rate-limited server-side — see the route. */
export async function reextract(url: string): Promise<{ recipe: Recipe }> {
  const res = await fetch("/api/recipes/reextract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || "Could not read that page again."), {
      code: typeof data.code === "string" ? data.code : undefined,
      status: res.status,
    });
  }
  return data as { recipe: Recipe };
}

async function post(body: unknown): Promise<ExtractResponse> {
  const res = await fetch("/api/recipes/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server sends a machine-readable `code` alongside the prose so the
    // caller never has to read the prose. Carrying it here is the point: the
    // spent-trial branch used to be found by matching /free recipe/i against
    // this message, which meant rewording a sentence would silently stop the
    // paste box becoming the sign-up path — a funnel that fails open into a
    // dead end, with nothing failing to say so.
    throw Object.assign(new Error(data.error || "Could not read that recipe."), {
      code: typeof data.code === "string" ? data.code : undefined,
      status: res.status,
    });
  }
  return data as ExtractResponse;
}

export const extractFromUrl = (url: string) => post({ url });
export const extractFromText = (text: string) => post({ text });
export const extractFromFile = (data: string, mediaType: string) =>
  post({ file: { data, mediaType } });

export interface SearchResult {
  title: string;
  url: string;
  site: string;
  note: string;
  /** The server already has a tree for this URL: it opens with no extraction,
   *  and it does not spend the free one. */
  cached?: boolean;
}

export async function searchRecipes(query: string): Promise<SearchResult[]> {
  const res = await fetch("/api/recipes/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not search for recipes.");
  return (data.results ?? []) as SearchResult[];
}

/** Strips the data: prefix the FileReader adds, which the API does not want. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
