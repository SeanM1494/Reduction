/**
 * lib/sharedPage.ts — what another app's Share sheet hands Reduction, and
 * where it waits until Find can read it.
 *
 * THE ROUTE IN. The share extension (expo-share-intent, app.json) stores what
 * was shared in the App Group and opens `reduction-mobile://dataUrl=…`;
 * `ShareReceiver` reads it through the package's hook, turns it into ONE of
 * three things here, and offers it to the store below. The signed-in tree
 * then opens Find, and Add New takes it and extracts it through the same
 * paths a paste, a link or the Browse tab use — nothing new on the server.
 *
 *   page  Safari's page itself: the extension's preprocessing script runs
 *         CAPTURE_BODY (lib/pageCapture.ts, the Browse tab's capture) in the
 *         page and hands over what Safari rendered. So a site that refuses
 *         our server (allrecipes.com) reads from a share exactly as it does
 *         from Browse — and is cached by content, never by URL.
 *   link  An address alone: any other app's share, or a page whose capture
 *         failed. Read as a pasted link is.
 *   text  Words that are not a link (a recipe shared from Notes): read as a
 *         pasted recipe is.
 *
 * WHY A STORE AND NOT A ROUTE PARAM. A share can arrive signed out, where
 * there is no navigator (app/_layout.tsx's Gate) — it waits here through
 * sign-in and is taken by the first Find that mounts after. It can carry a
 * page of up to 3 MB, which belongs in no URL. And it is taken ONCE: a later
 * visit to Find never extracts it again. Memory only: a share outlives
 * neither the process nor the next share (the newest wins — it is the one
 * the person just tapped).
 *
 * PURE ON PURPOSE (no react-native import), so the runner tests it under node.
 */

import { MAX_PAGE_CHARS, CAPTURE_BODY } from './pageCapture';

export type SharedItem =
  | { kind: 'page'; url: string; html: string }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string };

/** The fields of expo-share-intent's `ShareIntent` this reads, typed loosely
 *  so a package update that changes a field's shape lands as "nothing
 *  shared" rather than a crash. */
export interface ShareIntentLike {
  type?: string | null;
  text?: string | null;
  webUrl?: string | null;
  meta?: Record<string, unknown> | null;
}

/** The two keys our preprocessing script adds to the page's meta object. */
export const PAGE_URL_KEY = 'reductionPageUrl';
export const PAGE_HTML_KEY = 'reductionPageHtml';

const isHttpUrl = (s: string): boolean => /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s);

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** What was shared, or null when it is nothing Reduction can read (a file,
 *  an image, an empty share). */
export function sharedItemFrom(intent: ShareIntentLike | null | undefined): SharedItem | null {
  if (!intent) return null;
  const meta = intent.meta && typeof intent.meta === 'object' ? intent.meta : {};
  const pageUrl = str(meta[PAGE_URL_KEY]);
  const html = typeof meta[PAGE_HTML_KEY] === 'string' ? (meta[PAGE_HTML_KEY] as string) : '';
  const webUrl = str(intent.webUrl);
  const text = str(intent.text);

  const url = isHttpUrl(pageUrl) ? pageUrl : isHttpUrl(webUrl) ? webUrl : '';
  if (url && html) return { kind: 'page', url, html: html.length > MAX_PAGE_CHARS ? html.slice(0, MAX_PAGE_CHARS) : html };
  // The package calls ANY text with an address in it a 'weburl', so its
  // type cannot decide this. A recipe shared from Notes that mentions where
  // it came from is still the recipe; "look at this https://…" is the link.
  if (text && !isHttpUrl(text) && looksLikeRecipeText(text)) return { kind: 'text', text };
  if (url) return { kind: 'link', url };
  if (text) return { kind: 'text', text };
  return null;
}

/** Long enough, or on enough lines, to be the recipe rather than a
 *  sentence about a link. */
export function looksLikeRecipeText(text: string): boolean {
  return text.length >= 200 || text.split('\n').filter((l) => l.trim()).length >= 4;
}

/** The extension opens the app with `<scheme>://dataUrl=<scheme>ShareKey…`
 *  (expo-share-intent's ShareViewController). Not a route: the router is
 *  told to stay put (app/+native-intent.tsx) and the opening sequence
 *  counts it as a share (lib/opening/launch.ts). */
export function isShareLink(url: string | null | undefined, scheme: string): boolean {
  if (!url) return false;
  return url.toLowerCase().startsWith(`${scheme.toLowerCase()}://dataurl=`);
}

/**
 * The extension's page script: expo-share-intent splices this into its
 * preprocessor's `run()`, after it has built `metas` and before it calls
 * `completionFunction`. It runs the Browse tab's capture on Safari's
 * document and adds the result to `metas`, which reaches the app as
 * `shareIntent.meta`. A capture that throws leaves the share a link.
 *
 * app.json carries this string verbatim (`preprocessorInjectJS`): JSON
 * cannot import, so sharedPage.test.ts fails when the two differ, printing
 * the value to paste.
 */
export const SHARE_PREPROCESS_JS =
  `try { var reductionGot = (function (doc) { ${CAPTURE_BODY.trim()} })(document); ` +
  `metas.${PAGE_URL_KEY} = reductionGot.url; metas.${PAGE_HTML_KEY} = reductionGot.html; } catch (e) {}`;

// ——— the waiting share ———

let pending: { item: SharedItem; token: string } | null = null;
let seq = 0;
const listeners = new Set<() => void>();

/** A share arrived. Replaces one still waiting. */
export function offerShare(item: SharedItem): void {
  seq += 1;
  pending = { item, token: `share-${seq}` };
  for (const l of [...listeners]) l();
}

/** Whether a share is waiting, without taking it. */
export function hasPendingShare(): boolean {
  return pending !== null;
}

/** The waiting share, once: the next call answers null. */
export function takeShare(): { item: SharedItem; token: string } | null {
  const got = pending;
  pending = null;
  return got;
}

/** Called on every offer; returns the unsubscribe. */
export function onShare(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
