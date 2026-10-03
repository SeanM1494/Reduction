import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PAGE_HTML_KEY,
  PAGE_URL_KEY,
  SHARE_PREPROCESS_JS,
  hasPendingShare,
  isShareLink,
  offerShare,
  onShare,
  sharedItemFrom,
  takeShare,
} from './sharedPage';
import { CAPTURE_BODY, MAX_PAGE_CHARS } from './pageCapture';

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

test("the extension's page script is the Browse capture, and app.json carries it verbatim", () => {
  assert.ok(SHARE_PREPROCESS_JS.includes(CAPTURE_BODY.trim()));
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
