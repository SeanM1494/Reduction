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
 *         SHARE_CAPTURE_BODY below (the Browse tab's capture, smaller) in
 *         the page and hands over what Safari rendered. So a site that refuses
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

import { MAX_PAGE_CHARS } from './pageCapture';

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
 * The most a share may carry: a third of what Browse sends (Oct 4).
 *
 * Browse hands its capture straight to JS over the WebView bridge. A share
 * goes a longer way: Safari passes the result to the extension, which
 * JSON-encodes the page meta (already a JSON string, so every quote is
 * escaped twice) and stores it in the App Group's UserDefaults before
 * opening the app. iOS refuses a UserDefaults value of 4 MB or more, and
 * the extension has a small memory ceiling. A 3 MB page on that path
 * reached neither: on build 8 a share from Inspired Chef worked and one
 * from Sally's Baking Addiction (a page with hundreds of comments) froze
 * Safari's share step with nothing reaching the app. So a share also drops
 * comment threads, which never hold the recipe, and stops at 1,000,000
 * characters — escaped twice that is still far under 4 MB.
 */
export const SHARE_MAX_CHARS = 1_000_000;

/**
 * The share's capture, the body of `function (doc)` returning `{ url, html }`.
 * Browse's CAPTURE_BODY (lib/pageCapture.ts) plus two things: comment
 * threads go with the scripts and media, and when the page is still over
 * the cap the JSON-LD (where a recipe card's structured data lives, and what
 * the server's fast path reads) is moved to the front before the cut, so a
 * cut can only ever lose the end of the body.
 */
export const SHARE_CAPTURE_BODY = `
  var root = doc.documentElement.cloneNode(true);
  var drop = root.querySelectorAll(
    'script:not([type="application/ld+json"]),style,link,svg,noscript,iframe,frame,object,embed,video,audio,picture,source,canvas,template,img,#comments,.comments-area,.comment-list,.commentlist,#disqus_thread'
  );
  for (var i = 0; i < drop.length; i++) {
    if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
  }
  var html = '<!doctype html>' + root.outerHTML;
  if (html.length > ${SHARE_MAX_CHARS}) {
    var lds = root.querySelectorAll('script[type="application/ld+json"]');
    var ld = '';
    for (var j = 0; j < lds.length; j++) {
      ld += lds[j].outerHTML;
      if (lds[j].parentNode) lds[j].parentNode.removeChild(lds[j]);
    }
    html = ('<!doctype html><html><head>' + ld + '</head>' + root.outerHTML + '</html>').slice(0, ${SHARE_MAX_CHARS});
  }
  return { url: String(doc.location && doc.location.href || ''), html: html };
`;

/**
 * The extension's page script: expo-share-intent splices this into its
 * preprocessor's `run()`, after it has built `metas` and before it calls
 * `completionFunction`. It runs the share capture on Safari's document and
 * adds the result to `metas`, which reaches the app as `shareIntent.meta`.
 * A capture that throws leaves the share a link.
 *
 * app.json carries this string verbatim (`preprocessorInjectJS`): JSON
 * cannot import, so sharedPage.test.ts fails when the two differ, printing
 * the value to paste. It is built into the EXTENSION, so a change here
 * reaches phones only with a native build.
 */
export const SHARE_PREPROCESS_JS =
  `try { var reductionGot = (function (doc) { ${SHARE_CAPTURE_BODY.trim()} })(document); ` +
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
