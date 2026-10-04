import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PAGE_HTML_KEY,
  PAGE_URL_KEY,
  SHARE_CAPTURE_BODY,
  SHARE_CARD_TEXT_CHARS,
  SHARE_MAX_CHARS,
  SHARE_PREPROCESS_JS,
  hasPendingShare,
  isShareLink,
  offerShare,
  onShare,
  sharedItemFrom,
  takeShare,
} from './sharedPage';
import { MAX_PAGE_CHARS } from './pageCapture';

const S = 'reduction-mobile';

test("Safari's page arrives as the page, at the address the capture read", () => {
  const got = sharedItemFrom({
    type: 'weburl',
    text: 'https://www.allrecipes.com/recipe/1/?utm=x',
    webUrl: 'https://www.allrecipes.com/recipe/1/?utm=x',
    meta: { title: 'Pumpkin Bread', [PAGE_URL_KEY]: 'https://www.allrecipes.com/recipe/1/', [PAGE_HTML_KEY]: '<!doctype html><html></html>' },
  });
  assert.deepEqual(got, { kind: 'page', url: 'https://www.allrecipes.com/recipe/1/', html: '<!doctype html><html></html>' });
});

test('a page whose capture failed is still its link', () => {
  const got = sharedItemFrom({ type: 'weburl', text: 'https://a.example/r', webUrl: 'https://a.example/r', meta: { title: 'R' } });
  assert.deepEqual(got, { kind: 'link', url: 'https://a.example/r' });
});

test("the page's own address is used only when it is a web address", () => {
  const got = sharedItemFrom({
    type: 'weburl',
    webUrl: 'https://a.example/r',
    meta: { [PAGE_URL_KEY]: 'about:blank', [PAGE_HTML_KEY]: '<html></html>' },
  });
  assert.deepEqual(got, { kind: 'page', url: 'https://a.example/r', html: '<html></html>' });
});

test('a page over the server cap is cut to it, as the Browse capture is', () => {
  const html = 'x'.repeat(MAX_PAGE_CHARS + 10);
  const got = sharedItemFrom({ type: 'weburl', webUrl: 'https://a.example/r', meta: { [PAGE_HTML_KEY]: html } });
  assert.equal(got?.kind, 'page');
  assert.equal(got?.kind === 'page' && got.html.length, MAX_PAGE_CHARS);
});

test('a link from another app is a link; a sentence around it is still the link', () => {
  assert.deepEqual(sharedItemFrom({ type: 'weburl', text: 'https://a.example/r', webUrl: 'https://a.example/r' }), { kind: 'link', url: 'https://a.example/r' });
  assert.deepEqual(
    sharedItemFrom({ type: 'weburl', text: 'Look at this https://a.example/r', webUrl: 'https://a.example/r' }),
    { kind: 'link', url: 'https://a.example/r' },
  );
});

test('a recipe shared from Notes is the recipe, even when it names its source', () => {
  const text = 'Pumpkin bread\nfrom https://a.example/r\n2 cups flour\n1 cup pumpkin\nMix and bake 1 hour.';
  // The package marks any text with an address in it as a weburl.
  assert.deepEqual(sharedItemFrom({ type: 'weburl', text, webUrl: 'https://a.example/r' }), { kind: 'text', text });
  const plain = 'Flour, sugar, eggs.';
  assert.deepEqual(sharedItemFrom({ type: 'text', text: plain, webUrl: null }), { kind: 'text', text: plain });
});

test('nothing readable is nothing', () => {
  assert.equal(sharedItemFrom(null), null);
  assert.equal(sharedItemFrom({ type: 'media', text: null, webUrl: null, meta: null }), null);
  assert.equal(sharedItemFrom({ type: 'text', text: '   ' }), null);
  // A field of the wrong shape (a package update) is ignored, not thrown on.
  assert.deepEqual(sharedItemFrom({ type: 'weburl', webUrl: 'https://a.example/r', meta: { [PAGE_HTML_KEY]: 42 } as never }), { kind: 'link', url: 'https://a.example/r' });
});

test("the extension's link is a share, and nothing else is", () => {
  assert.equal(isShareLink('reduction-mobile://dataUrl=reduction-mobileShareKey?nonce=1#weburl', S), true);
  assert.equal(isShareLink('reduction-mobile://auth?code=x', S), false);
  assert.equal(isShareLink('reduction-mobile://recipe/abc', S), false);
  assert.equal(isShareLink(null, S), false);
});

test('a share is taken once, the newest wins, and listeners hear each offer', () => {
  let heard = 0;
  const off = onShare(() => (heard += 1));
  offerShare({ kind: 'link', url: 'https://a.example/1' });
  offerShare({ kind: 'link', url: 'https://a.example/2' });
  assert.equal(heard, 2);
  assert.equal(hasPendingShare(), true);
  const got = takeShare();
  assert.deepEqual(got?.item, { kind: 'link', url: 'https://a.example/2' });
  assert.equal(takeShare(), null, 'a later visit to Find never extracts it again');
  off();
  offerShare({ kind: 'text', text: 'x' });
  assert.equal(heard, 2);
  takeShare();
});

test("the extension's page script is the share capture, and app.json carries it verbatim", () => {
  assert.ok(SHARE_PREPROCESS_JS.includes(SHARE_CAPTURE_BODY.trim()));
  const appJson = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8'));
  const entry = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-share-intent');
  assert.ok(entry, 'expo-share-intent is configured in app.json');
  assert.equal(
    entry[1].preprocessorInjectJS,
    SHARE_PREPROCESS_JS,
    `app.json's preprocessorInjectJS must be exactly:\n${JSON.stringify(SHARE_PREPROCESS_JS)}`,
  );
});

test('the page script runs against a document and fills the two keys', () => {
  // The preprocessor's own frame: `metas` already built, then our lines.
  const metas: Record<string, string> = { title: 'T' };
  const removed: string[] = [];
  const node = (tag: string) => ({ tag, parentNode: { removeChild: () => removed.push(tag) } });
  const document = {
    location: { href: 'https://a.example/r' },
    querySelectorAll: () => [],
    documentElement: {
      cloneNode: () => ({
        querySelectorAll: () => [node('script'), node('img')],
        outerHTML: '<html><body>recipe</body></html>',
      }),
    },
  };
  new Function('metas', 'document', SHARE_PREPROCESS_JS)(metas, document);
  assert.equal(metas[PAGE_URL_KEY], 'https://a.example/r');
  assert.equal(metas[PAGE_HTML_KEY], '<!doctype html><html><body>recipe</body></html>');
  assert.deepEqual(removed, ['script', 'img']);
  // And a page that throws leaves the share a link.
  const bare: Record<string, string> = {};
  new Function('metas', 'document', SHARE_PREPROCESS_JS)(bare, {});
  assert.deepEqual(bare, {});
});

// A document for the share capture: nodes matched by tag, id or class, so
// the comment selectors are exercised as well as the tags.
function shareDoc(children: { tag: string; id?: string; cls?: string; type?: string; text: string }[]) {
  type N = (typeof children)[number] & { parentNode: { removeChild(n: N): void } | null; outerHTML: string };
  const kids: N[] = [];
  const html = (k: (typeof children)[number]) => `<${k.tag}${k.type ? ` type="${k.type}"` : ''}>${k.text}</${k.tag}>`;
  const matches = (k: N, sel: string) => {
    if (sel.startsWith('#')) return k.id === sel.slice(1);
    if (sel.startsWith('.')) return k.cls === sel.slice(1);
    const ld = /^script\[type="application\/ld\+json"\]$/.test(sel);
    if (ld) return k.tag === 'script' && k.type === 'application/ld+json';
    if (sel.startsWith('script:not')) return k.tag === 'script' && k.type !== 'application/ld+json';
    return k.tag === sel;
  };
  const root = {
    cloneNode: () => root,
    querySelectorAll: (sel: string) => kids.filter((k) => sel.split(',').some((s) => matches(k, s.trim()))),
    get outerHTML() {
      return `<html>${kids.map(html).join('')}</html>`;
    },
  };
  const parent = { removeChild: (n: N) => void kids.splice(kids.indexOf(n), 1) };
  for (const c of children) kids.push({ ...c, parentNode: parent, outerHTML: html(c) });
  // The live document, which the recipe-card path reads without cloning.
  const live = kids.map((k) => ({
    ...k,
    textContent: k.text,
    innerText: k.text,
    getAttribute: (a: string) => (a === 'property' ? k.cls : a === 'content' ? k.id : null),
  }));
  const pick = (sel: string) =>
    live.filter((k) =>
      sel.startsWith('meta') ? k.tag === 'meta' : sel.split(',').some((s) => matches(k, s.trim())),
    );
  return {
    documentElement: root,
    location: { href: 'https://a.example/r' },
    querySelectorAll: pick,
    querySelector: (sel: string) => pick(sel)[0] ?? null,
    body: { innerText: kids.filter((k) => k.tag !== 'script').map((k) => k.text).join('\n') },
  };
}
const share = (doc: unknown) => new Function('doc', SHARE_CAPTURE_BODY)(doc) as { url: string; html: string };

test('a share drops comment threads as well as scripts and media', () => {
  const got = share(
    shareDoc([
      { tag: 'script', type: 'application/ld+json', text: '{"@type":"Recipe"}' },
      { tag: 'p', text: 'Mix the flour.' },
      { tag: 'div', id: 'comments', text: 'Loved it! x400' },
      { tag: 'ol', cls: 'comment-list', text: 'Me too' },
      { tag: 'script', text: 'ads()' },
    ]),
  );
  assert.match(got.html, /\{"@type":"Recipe"\}/);
  assert.match(got.html, /Mix the flour\./);
  assert.doesNotMatch(got.html, /Loved it|Me too|ads\(\)/);
});

test('an enormous shared page stops at the share cap, keeping its JSON-LD whatever comes first', () => {
  const got = share(
    shareDoc([
      { tag: 'p', text: 'x'.repeat(SHARE_MAX_CHARS + 50) },
      { tag: 'script', type: 'application/ld+json', text: '{"@type":"Recipe","name":"Apple Crisp"}' },
    ]),
  );
  assert.equal(got.html.length, SHARE_MAX_CHARS);
  assert.match(got.html, /^<!doctype html><html><head><script type="application\/ld\+json">\{"@type":"Recipe","name":"Apple Crisp"\}<\/script><\/head>/);
});

test('a page under the cap is captured exactly as Browse would', () => {
  const got = share(shareDoc([{ tag: 'p', text: 'Bake.' }]));
  assert.equal(got.html, '<!doctype html><html><p>Bake.</p></html>');
});

test('the share cap, escaped twice, stays far under the 4 MB UserDefaults ceiling', () => {
  // Worst case: every character a quote, escaped by JSON.stringify twice.
  const worst = JSON.stringify(JSON.stringify({ h: '"'.repeat(SHARE_MAX_CHARS) }));
  assert.ok(Buffer.byteLength(worst) < 4_194_304, `${Buffer.byteLength(worst)} bytes`);
});

// A recipe card that the server's fast path reads (fetchSource.ts).
const CARD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', name: 'Chili' },
    {
      '@type': 'Recipe',
      name: 'The Best Chili',
      recipeIngredient: ['1 lb ground beef', '1 onion'],
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Brown the beef & onion.' }],
    },
  ],
});

test('a page with a recipe card shares the card, the og: tags and the text, never the page', () => {
  const got = share(
    shareDoc([
      { tag: 'title', text: 'Chili <Best>' },
      // getAttribute in this fake reads property from cls and content from id.
      { tag: 'meta', cls: 'og:image', id: 'https://a.example/c.jpg', text: '' },
      { tag: 'script', type: 'application/ld+json', text: '{"@type":"Organization"}' },
      { tag: 'script', type: 'application/ld+json', text: CARD },
      { tag: 'script', type: 'application/ld+json', text: '{"recipeIngredient":[], "recipeInstructions": [' },
      { tag: 'p', text: 'Brown the beef.' },
      { tag: 'div', id: 'comments', text: 'Loved it! '.repeat(400_000) },
      { tag: 'script', text: 'ads()' },
    ]),
  );
  // A four-million-character page; the share is the card plus capped text.
  assert.ok(got.html.length < SHARE_CARD_TEXT_CHARS + 2_000, `${got.html.length} characters`);
  assert.ok(got.html.includes(`<script type="application/ld+json">${CARD}</script>`));
  assert.ok(got.html.includes('<title>Chili &lt;Best&gt;</title>'));
  assert.ok(got.html.includes('<meta property="og:image" content="https://a.example/c.jpg">'));
  // Only the block that parses and holds a recipe; never the markup or scripts.
  assert.doesNotMatch(got.html, /Organization|ads\(\)|<p>/);
  assert.match(got.html, /<main>[^<]*Brown the beef\.[^<]*Loved it! /);
});

test("a page whose JSON-LD holds no recipe is captured as before", () => {
  const got = share(
    shareDoc([
      { tag: 'script', type: 'application/ld+json', text: '{"@type":"Article"}' },
      { tag: 'p', text: 'Bake.' },
    ]),
  );
  assert.equal(got.html, '<!doctype html><html><script type="application/ld+json">{"@type":"Article"}</script><p>Bake.</p></html>');
});
