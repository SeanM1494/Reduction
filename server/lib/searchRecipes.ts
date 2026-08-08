/**
 * server/lib/searchRecipes.ts — turn a free-text query into a short list of
 * candidate recipe pages, found live via Claude's own web search tool.
 *
 * The tool call happens on Anthropic's infrastructure and its results are
 * inserted into the conversation before the model answers, so every url the
 * model can plausibly cite already came from an actual search — this module
 * still cross-checks against those results and drops anything that doesn't
 * match, rather than trusting the model not to paraphrase or invent one.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not set. Add it in the Secrets tab.");
  if (!_client) _client = new Anthropic();
  return _client;
}

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

export interface SearchResult {
  title: string;
  url: string;
  site: string;
  note: string;
}

function textFrom(msg: Anthropic.Message): string {
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Models sometimes wrap JSON in fences, or add a sentence before/after it. */
function unwrap(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

/** Every url a search call actually returned, so results can be checked
 *  against reality instead of trusting the model's transcription of them. */
function urlsFromSearchResults(msg: Anthropic.Message): Set<string> {
  const urls = new Set<string>();
  for (const block of msg.content) {
    if (block.type !== "web_search_tool_result") continue;
    const content = block.content;
    if (!Array.isArray(content)) continue; // an error block, not results
    for (const item of content) urls.add(item.url);
  }
  return urls;
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
}

function siteFrom(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function searchRecipes(query: string): Promise<SearchResult[]> {
  const client = getClient();

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system:
      "You find real, currently-live recipe pages on the web for a cooking " +
      "app. Use the web search tool to find them — never invent, guess, or " +
      "reconstruct a URL from memory.",
    messages: [
      {
        role: "user",
        content:
          `Find 6 to 8 real recipe pages for: ${query}\n\n` +
          `Prefer distinct domains, and pages that are a single recipe rather ` +
          `than a roundup or listicle. Every url in your answer must be one ` +
          `that a search call actually returned.\n\n` +
          `Return ONLY a JSON array, nothing else, no markdown fences:\n` +
          `[{ "title": string, "url": string, "site": string, "note": string }]\n\n` +
          `"note" is one short line, under 12 words, on what distinguishes ` +
          `that version — e.g. "brown butter, chilled overnight".`,
      },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  });

  const searchedUrls = urlsFromSearchResults(msg);
  const raw = textFrom(msg);
  const json = unwrap(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Could not read search results. Try a different search.");
  }
  if (!Array.isArray(parsed))
    throw new Error("Could not read search results. Try a different search.");

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { title, url, site, note } = item as Record<string, unknown>;
    if (!isHttpUrl(url)) continue;
    // If the model made any search calls at all, only keep urls one of them
    // actually returned. (Left permissive when there are none, so a model
    // that skips the tool call outright still surfaces a readable failure
    // downstream rather than a silently empty list.)
    if (searchedUrls.size && !searchedUrls.has(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: typeof title === "string" && title ? title : url,
      url,
      site: typeof site === "string" && site ? site : siteFrom(url),
      note: typeof note === "string" ? note.slice(0, 200) : "",
    });
  }

  return results;
}
