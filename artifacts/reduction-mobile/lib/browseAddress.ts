/**
 * lib/browseAddress.ts — what the Browse tab's address bar does with what
 * was typed: a web address loads, anything else is a search.
 *
 * THE SEARCH ENGINE IS ONE CONSTANT. DuckDuckGo, because it needs no
 * account and shows no consent wall, which suits a browser that keeps
 * nothing; Google's recipe results are richer. To switch, change the one
 * line below — and public/privacy.html, which names the engine the words go
 * to (the phone sends them straight there; they never reach our server).
 *
 * PURE: no react-native import, no `@/` alias, so browseAddress.test.ts runs
 * under node.
 */

export const SEARCH_ENGINE = { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' } as const;
// Google: { name: 'Google', url: 'https://www.google.com/search?q=' }

/** The search page for `words`. */
export const searchUrl = (words: string): string => `${SEARCH_ENGINE.url}${encodeURIComponent(words.trim())}`;

/** "allrecipes.com", "www.bbcgoodfood.com/recipes/x", "food52.com:443/y" —
 *  one token, a dot, a letters-only top-level part. "banana bread" and
 *  "3.5 cups" are not. */
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/**
 * The page to load for what was typed, or null for nothing. A full http(s)
 * address loads as it is; a bare domain gains https://; everything else —
 * words, a single word, anything with a space — is searched for.
 */
export function addressFor(typed: string): string | null {
  const raw = typed.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      new URL(raw);
      return raw;
    } catch {
      return searchUrl(raw);
    }
  }
  if (!/\s/.test(raw) && BARE_DOMAIN.test(raw)) return `https://${raw}`;
  return searchUrl(raw);
}

/** The words a search page was for, to show in the address bar instead of
 *  the engine's URL; null for any other page. */
export function searchWordsOf(url: string): string | null {
  if (!url.startsWith(SEARCH_ENGINE.url)) return null;
  try {
    return new URL(url).searchParams.get('q');
  } catch {
    return null;
  }
}

/**
 * One page, however its address was spelled: host without "www.", path
 * without a trailing slash, lower-case, no query or fragment — enough to
 * tell that a suggestion is a page already in the person's box.
 */
export function pageIdentity(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}
