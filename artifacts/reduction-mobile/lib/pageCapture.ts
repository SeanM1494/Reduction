/**
 * lib/pageCapture.ts — reading the page the in-app browser is showing, for
 * `POST /api/recipes/extract { page }` (README "How extraction works").
 *
 * WHY THE PHONE READS THE PAGE. Some sites refuse every server: allrecipes.com
 * answers our fetch with a 402 and refuses Anthropic's outright. They do not
 * refuse a person, so the app opens the page in a real browser engine on the
 * phone (react-native-webview: WKWebView, the engine Safari uses), the person
 * checks it is the recipe, and Extract hands over what the browser rendered
 * — after the page's own JavaScript has run, so a recipe drawn client-side
 * is there too.
 *
 * WHAT IS SENT. The rendered document with its scripts, styles, frames and
 * media removed — EXCEPT `application/ld+json` scripts, which are where a
 * recipe card's structured data lives and what makes the fast, one-call,
 * own-wording path possible. A 1–3 MB recipe page comes down to a few
 * hundred KB, and the server's cap (3,000,000 characters) is kept here too
 * so an enormous page is cut at its end rather than refused: the head, and
 * the JSON-LD in it, come first.
 *
 * PURE ON PURPOSE: no react-native import, so the runner loads this file and
 * its test under node. The capture itself is a STRING, not a function turned
 * into one: Hermes compiles to bytecode and `Function.prototype.toString`
 * returns no source there, so a stringified function would inject nothing.
 */

/** The server's cap (routes/recipes.ts MAX_PAGE_CHARS). */
export const MAX_PAGE_CHARS = 3_000_000;

const MESSAGE_TYPE = 'reduction-page-capture';

/**
 * The body of `function (doc)`: returns `{ url, html }` for the document it
 * is given. The native browser runs it on `document` inside the page; the
 * web preview runs it on a same-origin iframe's document.
 */
export const CAPTURE_BODY = `
  var root = doc.documentElement.cloneNode(true);
  var drop = root.querySelectorAll(
    'script:not([type="application/ld+json"]),style,link,svg,noscript,iframe,frame,object,embed,video,audio,picture,source,canvas,template,img'
  );
  for (var i = 0; i < drop.length; i++) {
    if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
  }
  var html = '<!doctype html>' + root.outerHTML;
  if (html.length > ${MAX_PAGE_CHARS}) html = html.slice(0, ${MAX_PAGE_CHARS});
  return { url: String(doc.location && doc.location.href || ''), html: html };
`;

/** A fresh value per capture, so an answer is matched to the question. */
export const newNonce = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * What the native browser injects: capture, then post the result back
 * through the bridge, tagged with `nonce`. Ends in `true` because
 * react-native-webview wants an injected script to evaluate to a value.
 */
export function captureScript(nonce: string): string {
  return `(function () {
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  try {
    var got = (function (doc) { ${CAPTURE_BODY} })(document);
    post({ type: ${JSON.stringify(MESSAGE_TYPE)}, nonce: ${JSON.stringify(nonce)}, url: got.url, html: got.html });
  } catch (e) {
    post({ type: ${JSON.stringify(MESSAGE_TYPE)}, nonce: ${JSON.stringify(nonce)}, error: String(e && e.message || e) });
  }
})();
true;`;
}

export type CaptureResult = { ok: true; url: string; html: string } | { ok: false; error: string };

/**
 * The browser's reply, if it is the answer to THIS capture — anything else
 * the page posts (pages do use the bridge's name) is ignored as null. A
 * page could forge a reply, but only with its own content: the person is
 * extracting that page anyway, and the server treats every page as data.
 */
export function readCaptureMessage(data: string, nonce: string): CaptureResult | null {
  let m: { type?: unknown; nonce?: unknown; url?: unknown; html?: unknown; error?: unknown };
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || m.type !== MESSAGE_TYPE || m.nonce !== nonce) return null;
  if (typeof m.error === 'string') return { ok: false, error: m.error };
  if (typeof m.url !== 'string' || typeof m.html !== 'string') return { ok: false, error: 'The page sent nothing back.' };
  return { ok: true, url: m.url, html: m.html };
}

/** Only web pages load in the browser; anything else (an app link, mailto:,
 *  tel:) is refused rather than handed to another app mid-recipe. */
export const isWebUrl = (url: string): boolean => /^(https?:|about:blank)/i.test(url);

/** "www.allrecipes.com" → "allrecipes.com", for the header. */
export function hostLabel(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, '') : '';
}

// ---------------------------------------------------------------------------
// "Is there a recipe on this page?" — asked before anything is spent.
// ---------------------------------------------------------------------------

const DETECT_TYPE = 'reduction-page-detect';

/**
 * The body of `function (doc)`: collects the few things that say "recipe"
 * and returns them for `looksLikeRecipe` to judge — collecting in the page
 * and judging here keeps the judgement pure and under test. Cheap: a few
 * selectors, the first 400 list items' first 60 characters.
 */
export const DETECT_BODY = `
  var ld = [];
  var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < scripts.length && i < 20; i++) ld.push(String(scripts[i].textContent || '').slice(0, 200000));
  var microdata = !!doc.querySelector('[itemtype*="schema.org/Recipe"]');
  var plugin = !!doc.querySelector('.wprm-recipe-container,.wprm-recipe,.tasty-recipes,.mv-create-card,.easyrecipe,.zlrecipe-container,.recipe-card-details,[class*="recipe-card"]');
  var headings = [];
  var hs = doc.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var j = 0; j < hs.length && j < 200; j++) headings.push(String(hs[j].textContent || '').trim().slice(0, 60));
  var items = [];
  var lis = doc.querySelectorAll('li');
  for (var k = 0; k < lis.length && k < 400; k++) items.push(String(lis[k].textContent || '').trim().slice(0, 60));
  return { ld: ld, microdata: microdata, plugin: plugin, headings: headings, items: items };
`;

export interface PageSignals {
  ld: string[];
  microdata: boolean;
  plugin: boolean;
  headings: string[];
  items: string[];
}

/** Does this JSON-LD text declare a Recipe anywhere — top level, in an
 *  array, in an @graph, or as one of several @types? */
export function ldHasRecipe(text: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Some pages publish JSON-LD that is not quite JSON; the declaration
    // itself is still plain to see.
    return /"@type"\s*:\s*(\[[^\]]*)?"(?:schema:|https?:\/\/schema\.org\/)?Recipe"/.test(text);
  }
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): boolean => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    const t = o['@type'];
    const isRecipe = (x: unknown) => typeof x === 'string' && /(^|[/:])Recipe$/.test(x);
    if (isRecipe(t) || (Array.isArray(t) && t.some(isRecipe))) return true;
    return walk(o['@graph'], depth + 1) || Object.values(o).some((x) => typeof x === 'object' && walk(x, depth + 1));
  };
  return walk(data, 0);
}

/** An ingredient line: it starts with an amount. */
const AMOUNT_START = /^(?:\d+(?:[.,/]\d+)?|\d*\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*(?:-|–|to)?\s*\S/;

/**
 * The verdict. Any ONE strong signal is enough — the structured data a
 * recipe card publishes, the same thing as microdata, or the container of a
 * recipe-card plugin (WP Recipe Maker, Tasty, Create…) — and failing those,
 * an "Ingredients" heading with at least three list items that start with
 * an amount. Deliberately generous: a wrong "no" costs a person a tap on
 * "Try anyway", a wrong "yes" costs one extraction the server's own
 * no-recipe check then refuses.
 */
export function looksLikeRecipe(s: PageSignals): boolean {
  if (s.microdata || s.plugin) return true;
  if (s.ld.some(ldHasRecipe)) return true;
  const heading = s.headings.some((h) => /^ingredients\b/i.test(h.replace(/^[^a-z]+/i, '')));
  if (!heading) return false;
  return s.items.filter((t) => AMOUNT_START.test(t)).length >= 3;
}

/** What the native browser injects to ask: collect, then post the signals
 *  back tagged with `nonce`. */
export function detectScript(nonce: string): string {
  return `(function () {
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  try {
    var got = (function (doc) { ${DETECT_BODY} })(document);
    post({ type: ${JSON.stringify(DETECT_TYPE)}, nonce: ${JSON.stringify(nonce)}, signals: got });
  } catch (e) {
    post({ type: ${JSON.stringify(DETECT_TYPE)}, nonce: ${JSON.stringify(nonce)}, error: String(e && e.message || e) });
  }
})();
true;`;
}

/**
 * The browser's answer to THIS question: true or false, or null when the
 * page could not be asked (a script error) — which the caller treats as
 * "unknown" and does not stop anyone over. Anything else is not ours: undefined.
 */
export function readDetectMessage(data: string, nonce: string): boolean | null | undefined {
  let m: { type?: unknown; nonce?: unknown; signals?: unknown };
  try {
    m = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!m || m.type !== DETECT_TYPE || m.nonce !== nonce) return undefined;
  const sig = m.signals as Partial<PageSignals> | undefined;
  if (!sig || typeof sig !== 'object') return null;
  return looksLikeRecipe({
    ld: Array.isArray(sig.ld) ? sig.ld.filter((x): x is string => typeof x === 'string') : [],
    microdata: sig.microdata === true,
    plugin: sig.plugin === true,
    headings: Array.isArray(sig.headings) ? sig.headings.filter((x): x is string => typeof x === 'string') : [],
    items: Array.isArray(sig.items) ? sig.items.filter((x): x is string => typeof x === 'string') : [],
  });
}
