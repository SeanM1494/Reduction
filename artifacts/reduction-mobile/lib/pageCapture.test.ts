import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_BODY, MAX_PAGE_CHARS, captureScript, hostLabel, isWebUrl, readCaptureMessage } from './pageCapture';

// A minimal document: enough of the DOM API for the capture body to run
// under node, so what it keeps and drops is asserted, not assumed.
function fakeDoc(children: { tag: string; type?: string; text: string }[], href = 'https://example.com/r') {
  type N = { tag: string; type?: string; text: string; parentNode: { removeChild(n: N): void } | null };
  const kids: N[] = [];
  const root = {
    cloneNode: () => root,
    querySelectorAll(sel: string) {
      // The selector the body uses, interpreted: every listed tag, except
      // a script whose type is application/ld+json.
      const tags = sel
        .split(',')
        .map((s) => s.trim().replace(/:not\(.*\)$/, ''));
      return kids.filter((k) => tags.includes(k.tag) && !(k.tag === 'script' && k.type === 'application/ld+json'));
    },
    get outerHTML() {
      return `<html>${kids.map((k) => `<${k.tag}${k.type ? ` type="${k.type}"` : ''}>${k.text}</${k.tag}>`).join('')}</html>`;
    },
  };
  const parent = { removeChild: (n: N) => kids.splice(kids.indexOf(n), 1) };
  for (const c of children) kids.push({ ...c, parentNode: parent });
  return { documentElement: root, location: { href } };
}

const run = (doc: unknown) => new Function('doc', CAPTURE_BODY)(doc) as { url: string; html: string };

test('capture keeps the page and its JSON-LD, drops scripts, styles and media', () => {
  const got = run(
    fakeDoc([
      { tag: 'script', type: 'application/ld+json', text: '{"@type":"Recipe"}' },
      { tag: 'script', text: 'trackEverything()' },
      { tag: 'style', text: '.a{}' },
      { tag: 'img', text: '' },
      { tag: 'p', text: 'Mix the flour.' },
    ])
  );
  assert.equal(got.url, 'https://example.com/r');
  assert.match(got.html, /^<!doctype html>/);
  assert.match(got.html, /application\/ld\+json">\{"@type":"Recipe"\}/, 'the structured data survives');
  assert.match(got.html, /Mix the flour\./);
  assert.doesNotMatch(got.html, /trackEverything|\.a\{\}|<img/);
});

test('capture cuts an enormous page at its end, never past the server cap', () => {
  const got = run(fakeDoc([{ tag: 'p', text: 'x'.repeat(MAX_PAGE_CHARS + 50) }]));
  assert.equal(got.html.length, MAX_PAGE_CHARS);
  assert.match(got.html, /^<!doctype html><html><p>x/, 'the head end is what is kept');
});

test('the injected script is one self-contained string that posts its nonce', () => {
  const s = captureScript('n-1');
  assert.match(s, /"n-1"/);
  assert.match(s, /ReactNativeWebView\.postMessage/);
  assert.match(s.trim(), /true;$/);
  // It compiles as JavaScript (what WKWebView will evaluate).
  assert.doesNotThrow(() => new Function(s));
});

test("a reply counts only when it answers THIS capture", () => {
  const ok = JSON.stringify({ type: 'reduction-page-capture', nonce: 'a', url: 'https://x.com/r', html: '<p>hi</p>' });
  assert.deepEqual(readCaptureMessage(ok, 'a'), { ok: true, url: 'https://x.com/r', html: '<p>hi</p>' });
  assert.equal(readCaptureMessage(ok, 'b'), null, 'a stale capture');
  assert.equal(readCaptureMessage('{"type":"analytics","nonce":"a"}', 'a'), null, "the page's own traffic");
  assert.equal(readCaptureMessage('not json', 'a'), null);
  assert.deepEqual(readCaptureMessage(JSON.stringify({ type: 'reduction-page-capture', nonce: 'a', error: 'boom' }), 'a'), {
    ok: false,
    error: 'boom',
  });
  assert.equal(readCaptureMessage(JSON.stringify({ type: 'reduction-page-capture', nonce: 'a' }), 'a')?.ok, false);
});

test('only web pages load; the header shows the site', () => {
  assert.equal(isWebUrl('https://www.allrecipes.com/recipe/1/'), true);
  assert.equal(isWebUrl('about:blank'), true);
  for (const u of ['mailto:a@b.c', 'tel:123', 'itms-apps://x', 'intent://x', 'javascript:alert(1)']) assert.equal(isWebUrl(u), false, u);
  assert.equal(hostLabel('https://www.allrecipes.com/recipe/1/'), 'allrecipes.com');
  assert.equal(hostLabel('not a url'), '');
});
