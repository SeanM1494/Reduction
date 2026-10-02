import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOTTLE, CREAM, DROPS, DROP_D, DROP_FILL, POT, SHAKER, STREAM } from './brandShapes';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (f: string) => readFileSync(join(ROOT, 'brand', 'opening', f), 'utf8');

type Parsed = { tag: string; attrs: Record<string, string> };

/** The drawn elements of an SVG, in document order. Enough XML for our own
 *  artwork, which has no entities, no nesting quirks and one quote style. */
function elements(svg: string): Parsed[] {
  const out: Parsed[] = [];
  for (const m of svg.matchAll(/<(rect|circle|ellipse|path)\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push({ tag: m[1], attrs });
  }
  return out;
}

const norm = (d: string) => d.replace(/\s+/g, ' ').replace(/([A-Za-z])\s*/g, '$1 ').trim();

/** What brandShapes says the file holds, in the file's order. */
function expected(withBackground: boolean): Parsed[] {
  const s = (o: Record<string, unknown>) => {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'tag' || v === undefined) continue;
      if (k === 'clip') attrs['clip-path'] = `url(#${v}-clip)`;
      else attrs[k] = String(v);
    }
    return attrs;
  };
  const els: Parsed[] = [];
  if (withBackground) els.push({ tag: 'rect', attrs: { id: 'bg', width: '1024', height: '1024', fill: CREAM } });
  for (const h of POT.handles) els.push({ tag: 'rect', attrs: s({ ...h, fill: POT.handleFill }) });
  els.push({ tag: 'path', attrs: { d: POT.body.d, fill: POT.body.fill } });
  els.push({ tag: 'ellipse', attrs: s(POT.rim) });
  els.push({ tag: 'ellipse', attrs: s(POT.inner) });
  els.push({ tag: 'ellipse', attrs: s(POT.slick) });
  for (const f of POT.flecks) els.push({ tag: 'circle', attrs: s(f) });
  for (const c of STREAM) els.push({ tag: 'circle', attrs: s(c) });
  for (const d of DROPS) els.push({ tag: 'path', attrs: { transform: `translate(${d.x} ${d.y}) scale(${d.s})`, d: DROP_D } });
  els.push({ tag: 'rect', attrs: s(SHAKER.clip) });
  for (const e of SHAKER.els) els.push({ tag: e.tag, attrs: s(e) });
  els.push({ tag: 'path', attrs: { d: BOTTLE.clipD } });
  for (const e of BOTTLE.els) els.push({ tag: e.tag, attrs: s(e) });
  return els;
}

function same(actual: Parsed[], want: Parsed[]) {
  assert.equal(actual.length, want.length, 'element count');
  actual.forEach((a, i) => {
    const w = want[i];
    assert.equal(a.tag, w.tag, `element ${i} tag`);
    assert.deepEqual(Object.keys(a.attrs).sort(), Object.keys(w.attrs).sort(), `element ${i} (${a.tag}) attributes`);
    for (const k of Object.keys(a.attrs)) {
      const [x, y] = [a.attrs[k], w.attrs[k]];
      if (k === 'd') assert.equal(norm(x), norm(y), `element ${i} d`);
      else if (/^-?[\d.]+$/.test(x)) assert.equal(Number(x), Number(y), `element ${i} ${k}`);
      else assert.equal(x.toLowerCase(), y.toLowerCase(), `element ${i} ${k}`);
    }
  });
}

test('brandShapes is brand/opening/opening-scene.svg, element for element', () => {
  same(elements(read('opening-scene.svg')), expected(true));
});

test('the groups place the shaker, the bottle and the drops where brandShapes says', () => {
  const svg = read('opening-scene.svg');
  const g = (id: string) => svg.match(new RegExp(`<g id="${id}"([^>]*)>`))?.[1] ?? '';
  assert.match(g('spice-shaker'), new RegExp(`translate\\(${SHAKER.at.x} ${SHAKER.at.y}\\) rotate\\(${SHAKER.at.rotate}\\)`));
  assert.match(g('vinegar-bottle'), new RegExp(`translate\\(${BOTTLE.at.x} ${BOTTLE.at.y}\\) rotate\\(${BOTTLE.at.rotate}\\)`));
  assert.match(g('vinegar-drops'), new RegExp(`fill="${DROP_FILL}"`));
});

test('the extents hold every point of the shaker and the bottle at any rotation', () => {
  const far = (els: readonly { tag: string }[]) => {
    let m = 0;
    for (const e of els as any[]) {
      if (e.tag === 'rect') for (const [x, y] of [[e.x, e.y], [e.x + e.width, e.y], [e.x, e.y + e.height], [e.x + e.width, e.y + e.height]]) m = Math.max(m, Math.hypot(x, y));
      if (e.tag === 'circle') m = Math.max(m, Math.hypot(e.cx, e.cy) + e.r);
      if (e.tag === 'path') for (const [x, y] of (e.d.match(/-?[\d.]+\s+-?[\d.]+/g) ?? []).map((p: string) => p.split(/\s+/).map(Number))) m = Math.max(m, Math.hypot(x, y));
    }
    return m;
  };
  assert.ok(far(SHAKER.els) < SHAKER.extent);
  assert.ok(far(BOTTLE.els) < BOTTLE.extent);
});
