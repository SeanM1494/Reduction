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

async function post(body: unknown): Promise<ExtractResponse> {
  const res = await fetch("/api/recipes/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not read that recipe.");
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
