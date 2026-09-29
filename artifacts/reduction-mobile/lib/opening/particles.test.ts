import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { BUBBLES, FULL, QUICK } from './config';
import { makeParticles } from './particles';

const ROOT = join(__dirname, '..', '..', '..', '..');

/** The prototype's own script, from its generator to its bubbles — the
 *  part before it touches the page — run as it is. */
function prototype() {
  const html = readFileSync(join(ROOT, 'docs', 'prototypes', 'opening-sequence.html'), 'utf8');
  const from = html.indexOf('var cl=');
  const to = html.indexOf('var bars=');
  assert.ok(from > 0 && to > from, 'the prototype script still has the section this test reads');
  const ctx: Record<string, unknown> = { Math };
  vm.runInNewContext(`${html.slice(from, to)}; this.out = { F: F, Q: Q, DATA: DATA, bub: bub };`, ctx);
  return ctx.out as { F: any; Q: any; DATA: any; bub: any[] };
}

test('the timelines are the prototype F and Q, number for number', () => {
  const p = prototype();
  for (const [ours, theirs] of [
    [FULL, p.F],
    [QUICK, p.Q],
  ] as const) {
    for (const key of Object.keys(theirs)) {
      if (key === 'pour' || key === 'fade') continue;
      assert.equal(JSON.stringify((ours as any)[key]), JSON.stringify(theirs[key]), key);
    }
  }
});

test('every particle, drop, ripple and bubble is where the prototype puts it', () => {
  const p = prototype();
  const ours = makeParticles();
  const close = (a: any, b: any, what: string) => {
    for (const k of Object.keys(b)) {
      if (typeof b[k] === 'number') assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${what}.${k}: ${a[k]} vs ${b[k]}`);
    }
  };
  for (const v of ['full', 'quick'] as const) {
    assert.equal(ours[v].spice.length, p.DATA[v].spice.length);
    ours[v].spice.forEach((s, i) => {
      close(s, p.DATA[v].spice[i], `${v}.spice[${i}]`);
      assert.equal(s.c, p.DATA[v].spice[i].c);
    });
    ours[v].drops.forEach((d, i) => close(d, p.DATA[v].drops[i], `${v}.drops[${i}]`));
    assert.equal(ours[v].ripples.length, p.DATA[v].rips.length);
    ours[v].ripples.forEach((r, i) => close(r, p.DATA[v].rips[i], `${v}.ripples[${i}]`));
  }
  assert.equal(ours.bubbles.length, p.bub.length);
  ours.bubbles.forEach((b, i) => close(b, p.bub[i], `bubbles[${i}]`));
});

test('deterministic: the same seed, the same sequence, every time', () => {
  assert.deepEqual(makeParticles(), makeParticles());
});

test('cutting the bubble count keeps the same bubbles, not new ones', () => {
  const all = makeParticles();
  const fewer = makeParticles(7, { large: 13, small: 9 });
  assert.equal(fewer.bubbles.length, 22);
  assert.deepEqual(fewer.bubbles.slice(0, 13), all.bubbles.slice(0, 13));
  assert.deepEqual(fewer.bubbles.slice(13), all.bubbles.slice(BUBBLES.large, BUBBLES.large + 9));
  // and the pour is untouched by it
  assert.deepEqual(fewer.full, all.full);
});
