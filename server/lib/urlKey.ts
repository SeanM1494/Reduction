/**
 * server/lib/urlKey.ts — two cache keys for one URL.
 *
 * `extraction_cache` is keyed on `sha256("url:" + the raw string)`, so a
 * trailing slash, a `utm_` parameter, `http` vs `https`, `www.` or a
 * `#fragment` each pay for a fresh extraction of a page somebody has already
 * paid for. Every one of those misses is margin: an extraction is an API call
 * against revenue already collected, and a cache hit costs essentially
 * nothing to serve.
 *
 * THE RAW KEY IS STILL THE IDENTITY. THIS IS AN ALIAS.
 *
 * `cacheGet` tries the exact hash first and only then this one, and `cacheSet`
 * writes both. That is deliberate and it is what makes normalising safe to
 * ship before corrections propagate between users (ROADMAP #3): if any fold
 * below turns out to be wrong for some site, dropping the alias lookup is a
 * one-line change and every stored row is still correct and still addressable
 * by the string that produced it. Nothing has to be migrated to undo this.
 *
 * CORRECTNESS IS THE CONSTRAINT, HIT-RATE IS THE OBJECTIVE.
 *
 * A miss costs one extraction. Serving the WRONG recipe costs trust, and no
 * number of hits pays for it. So the query rule is a DENY-LIST of parameters
 * known to be inert, never an allow-list of parameters to keep: `?page=2`,
 * `?print=1` and `?servings=6` select content, and an allow-list gets that
 * backwards by default — it would drop every parameter it had not heard of,
 * silently, on exactly the pages where the parameter mattered.
 *
 * The same instinct rules out two folds that look tempting:
 *
 *   - **Lowercasing the path.** Hosts are case-insensitive; paths are not.
 *   - **Stripping a trailing `/amp` path segment.** `?amp=1` is a rendering
 *     flag and is folded below, but a path segment is a real path, and a page
 *     that genuinely lives at `/amp` is not the same page as its parent.
 */

import crypto from "node:crypto";

/**
 * Query parameters that cannot select content, folded away.
 *
 * Each entry is here because it is a tracking or analytics token with a
 * standardised meaning, not because it looked disposable. Three that were
 * considered and REJECTED: `ref`, `source` and `campaign`. All three are
 * common as trackers and all three are also plausible as content selectors on
 * somebody's site, and the cost of being wrong is asymmetric.
 */
const INERT_PARAMS = new Set([
  // Ad-click identifiers.
  "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid",
  "twclid", "ttclid", "igshid", "li_fat_id", "epik", "s_kwcid",
  // Email campaign tokens.
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "vero_id", "vero_conv",
  "oly_anon_id", "oly_enc_id",
  // Analytics linkers.
  "_ga", "_gl", "gad_source", "gclsrc",
  // A rendering flag rather than a content selector: the AMP version of a
  // recipe page is the same recipe, and extraction produces the same tree.
  "amp",
]);

/** Prefixed families, all of them analytics conventions. */
const INERT_PREFIXES = ["utm_", "pk_", "piwik_", "matomo_", "hsa_"];

const isInert = (name: string): boolean => {
  const k = name.toLowerCase();
  return INERT_PARAMS.has(k) || INERT_PREFIXES.some((p) => k.startsWith(p));
};

/**
 * The canonical form of a URL, or null when the string is not one we can
 * reason about.
 *
 * Null rather than a fallback to the raw string: a value we could not parse
 * has no alias, and giving it one that happens to equal some other unparsed
 * string is the one way this function could ever collide two real pages.
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }

  // Only the web. A `file:`, `data:` or `javascript:` URL has no business
  // being a cache alias, and normalising one would be meaningless anyway.
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;

  // Scheme and host. `http` and `https` serve the same recipe from every
  // recipe site in existence, and a bare host and its `www.` are the same
  // site often enough that the fold is worth far more than it risks.
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.port = "";

  // Never sent to the server, so it cannot possibly select content.
  u.hash = "";

  // Trailing slash, except on the root where it is the whole path.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  }

  for (const name of [...u.searchParams.keys()]) {
    if (isInert(name)) u.searchParams.delete(name);
  }
  // Stable per spec for repeated keys, so `?a=1&a=2` keeps its meaning.
  u.searchParams.sort();

  let out = u.toString();
  // `toString()` leaves a bare "?" behind once the last parameter goes.
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

/** The exact key, unchanged from the day the cache was written. */
export const rawKeyOf = (rawUrl: string): string =>
  crypto.createHash("sha256").update(`url:${rawUrl}`).digest("hex");

/**
 * The alias key. Deliberately a DIFFERENT prefix from the raw key, so a
 * normalised URL that happens to equal some other URL's raw string cannot
 * produce the same digest and let one lookup answer for the other.
 */
export function urlKeyOf(rawUrl: string): string | null {
  const normal = normalizeUrl(rawUrl);
  if (normal === null) return null;
  return crypto.createHash("sha256").update(`urlkey:${normal}`).digest("hex");
}
