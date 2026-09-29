import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FADE_LEVELS, FULL, MAX_HOLD_S, QUICK, STATIC, type Timeline } from './config';
import { POT } from './brandShapes';
import { makeParticles } from './particles';
import { advance, bodyPath, frameStats, sceneAt, stageFor, staticOpacity, tiltGeo, type Clock } from './scene';

const PARTS = makeParticles();
const PHONES = {
  'iPhone SE': stageFor(375, 667),
  'iPhone 13': stageFor(390, 844),
  'iPhone Pro Max': stageFor(430, 932),
  'the prototype stage (9:19)': stageFor(240, 506.25),
};
const at = (C: Timeline, t: number, st = PHONES['iPhone 13'], hold = 0) =>
  sceneAt(C, t, st, C.kind === 'full' ? PARTS.full : PARTS.quick, PARTS.bubbles, hold, 0, FADE_LEVELS);
const ID = { s: 1, ty: 626 };

// ——— a tiny path sampler: M H V Q C Z, absolute, as the two bodies use ———

function sample(d: string, per = 24): [number, number][] {
  const toks = d.match(/[MHVQCZ]|-?\d*\.?\d+(?:e-?\d+)?/g)!;
  const pts: [number, number][] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'M') {
      x = num();
      y = num();
      pts.push([x, y]);
    } else if (c === 'H' || c === 'V') {
      const v = num();
      const [x1, y1] = c === 'H' ? [v, y] : [x, v];
      for (let k = 1; k <= per; k++) pts.push([x + ((x1 - x) * k) / per, y + ((y1 - y) * k) / per]);
      [x, y] = [x1, y1];
    } else if (c === 'Q') {
      const [qx, qy, ex, ey] = [num(), num(), num(), num()];
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        pts.push([(1 - t) ** 2 * x + 2 * (1 - t) * t * qx + t * t * ex, (1 - t) ** 2 * y + 2 * (1 - t) * t * qy + t * t * ey]);
      }
      [x, y] = [ex, ey];
    } else if (c === 'C') {
      const [ax, ay, bx, by, ex, ey] = [num(), num(), num(), num(), num(), num()];
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        const u = 1 - t;
        pts.push([u ** 3 * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * ex, u ** 3 * y + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * ey]);
      }
      [x, y] = [ex, ey];
    }
  }
  return pts;
}

test('at rest, the pot wall is the icon pot, point for point', () => {
  const ours = sample(bodyPath(tiltGeo(0), ID));
  const brand = sample(POT.body.d);
  assert.equal(ours.length, brand.length);
  // Rounded to 0.1 in the string; a cubic equal to a quadratic samples the same.
  ours.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - brand[i][0]) < 0.11 && Math.abs(y - brand[i][1]) < 0.11, `point ${i}: ${x},${y} vs ${brand[i]}`);
  });
});

test('the wall foreshortens as the camera rises and never fades before it is flat', () => {
  let lastDepth = Infinity;
  let lastHf = Infinity;
  for (let k = 0; k <= 100; k++) {
    const tt = k / 100;
    const g = tiltGeo(tt);
    const depth = g.yb - g.A; // what shows of the wall below the rim
    assert.ok(depth <= lastDepth + 1e-9, `depth grows at ${tt}`);
    assert.ok(g.hf <= lastHf + 1e-9, `bars grow at ${tt}`);
    lastDepth = depth;
    lastHf = g.hf;
  }
  assert.ok(Math.abs(tiltGeo(1).hf) < 1e-9, 'looking straight down, the wall has no height');
  // The drawn wall is fully opaque for every frame of the rise until it has no height left.
  for (let t = 0; t <= FULL.total; t += 0.01) {
    const s = at(FULL, t);
    if (s.tilt <= 0.995) assert.equal(s.bodyOpacity, 1, `wall faded at t=${t.toFixed(2)}`);
  }
});

test('the bars squash with the wall', () => {
  const rest = at(FULL, 1.0).bars[0];
  const risen = at(FULL, 2.7).bars[0];
  const height = (d: string) => {
    const ys = sample(d.replace(/A[^A-Z]*?(?=[A-Z])/g, (m) => 'L' + m.split(/[ ,]+/).slice(-2).join(' ')).replace(/L/g, 'M')).map((p) => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(height(risen) < height(rest));
});

test('Full at its key times', () => {
  const s0 = at(FULL, 0);
  assert.equal(s0.potOpacity, 0);
  assert.equal(s0.shaker.opacity, 0);
  assert.deepEqual([...s0.spice, s0.drops], ['', '', '', '']);

  const s07 = at(FULL, 0.7);
  assert.equal(s07.shaker.opacity, 1);
  assert.equal(s07.shaker.rot, 132); // the icon pose, tipped in
  assert.equal(s07.bottle.rot, -128);

  const s15 = at(FULL, 1.5);
  assert.ok(s15.spice.join('').length > 0, 'spice pouring');
  assert.ok(s15.drops.length > 0, 'vinegar pouring');
  assert.ok(s15.bubbles.join('').length > 0, 'bubbling since 1.0');
  assert.ok(at(FULL, 0.95).bubbles.every((b) => b === ''), 'no bubbles before 1.0');

  assert.equal(at(FULL, 2.6).shaker.opacity, 0);
  assert.equal(at(FULL, 2.6).bottle.opacity, 0);
  assert.equal(at(FULL, 2.2).tilt, 0);
  assert.equal(at(FULL, 3.0).tilt, 1);
  assert.equal(at(FULL, 2.7).zoom, 1);
  assert.ok(Math.abs(at(FULL, 3.7).zoom - PHONES['iPhone 13'].zoomEnd) < 1e-9);

  const s345 = at(FULL, 3.45);
  assert.equal(s345.reveal, 0);
  assert.equal(s345.bgOn, true);
  assert.equal(s345.ringOpacity, 0);
  const s38 = at(FULL, 3.8);
  assert.ok(s38.reveal > 0 && s38.reveal < 1);
  assert.equal(s38.bgOn, false);
  assert.ok(s38.ringOpacity > 0);
  assert.equal(at(FULL, 4.15).reveal, 1);
  assert.equal(at(FULL, 4.15).ringOpacity, 0);
  assert.equal(at(FULL, 4.29).done, false);
  assert.equal(at(FULL, 4.3).done, true);
});

test('Quick is the same beats, compressed, shaker and bottle included', () => {
  assert.equal(at(QUICK, 0.35).shaker.opacity, 1);
  assert.equal(at(QUICK, 0.35).bottle.opacity, 1);
  assert.ok(at(QUICK, 0.7).spice.join('').length > 0);
  assert.equal(at(QUICK, 1.15).shaker.opacity, 0);
  assert.equal(at(QUICK, 1.4).tilt, 1);
  assert.equal(at(QUICK, 1.55).reveal, 0);
  assert.equal(at(QUICK, 2.05).reveal, 1);
  assert.equal(at(QUICK, 2.2).done, true);
});

test('every screen: the dive covers the half-diagonal, and the reveal clears it', () => {
  for (const [name, st] of Object.entries(PHONES)) {
    // Looking straight down, the liquid is a circle of radius 240.
    assert.ok(240 * st.zoomEnd >= 1.1 * st.hd, `${name}: the interior does not cover the screen`);
    assert.ok(st.revealMax >= 1.05 * st.hd, `${name}: the reveal stops short of a corner`);
    // Even at the reveal's first frame the zoom has the screen covered.
    const s = sceneAt(FULL, FULL.rev[0], st, PARTS.full, PARTS.bubbles, 0, 0, FADE_LEVELS);
    assert.ok(240 * s.zoom >= st.hd, `${name}: cream would show at the reveal's start`);
  }
  // And on the prototype's own 9:19 stage the numbers are the prototype's.
  const p = PHONES['the prototype stage (9:19)'];
  assert.ok(Math.abs(p.zoomEnd - 5.6) < 0.01);
  assert.ok(Math.abs(p.revealMax - 1280) < 1);
});

test('deterministic: the same time, the same frame', () => {
  assert.deepEqual(at(FULL, 1.73), at(FULL, 1.73));
  assert.deepEqual(at(QUICK, 0.91), at(QUICK, 0.91));
});

test('a held reveal keeps the bubbles moving and nothing else', () => {
  const still = at(FULL, FULL.rev[0], undefined, 0);
  const held = at(FULL, FULL.rev[0], undefined, 0.4);
  assert.notDeepEqual(held.bubbles, still.bubbles);
  assert.deepEqual({ ...held, bubbles: null }, { ...still, bubbles: null });
});

test('the clock: runs to the reveal, holds for the app up to the limit, then goes', () => {
  const rev = FULL.rev[0];
  const run = (c: Clock, frames: number, ready: boolean) => {
    for (let i = 0; i < frames; i++) c = advance(c, 1 / 60, ready, rev, FULL.total, MAX_HOLD_S);
    return c;
  };
  // Ready: straight through, no hold.
  const ready = run({ t: 0, hold: 0 }, 60 * 5, true);
  assert.equal(ready.t, FULL.total);
  assert.equal(ready.hold, 0);
  // Not ready: stops exactly at the reveal and holds...
  const waiting = run({ t: 0, hold: 0 }, Math.ceil(60 * (rev + 1)), false);
  assert.equal(waiting.t, rev);
  assert.ok(waiting.hold > 0.9 && waiting.hold <= MAX_HOLD_S);
  // ...goes the moment the app is ready...
  assert.ok(advance(waiting, 1 / 60, true, rev, FULL.total, MAX_HOLD_S).t > rev);
  // ...and goes anyway after the limit.
  const gaveUp = run({ t: 0, hold: 0 }, 60 * 8, false);
  assert.equal(gaveUp.t, FULL.total);
  assert.equal(gaveUp.hold, MAX_HOLD_S);
});

test('a long frame slows the sequence rather than skipping it', () => {
  assert.equal(advance({ t: 1, hold: 0 }, 0.5, true, 3.45, 4.3, 1.5).t, 1.05);
  assert.equal(advance({ t: 1, hold: 0 }, -1, true, 3.45, 4.3, 1.5).t, 1);
});

test('Reduce Motion: the still for 0.5s, then a 0.4s crossfade', () => {
  assert.equal(staticOpacity(0, STATIC.hold, STATIC.fade), 1);
  assert.equal(staticOpacity(0.5, STATIC.hold, STATIC.fade), 1);
  assert.ok(Math.abs(staticOpacity(0.7, STATIC.hold, STATIC.fade) - 0.5) < 1e-9);
  assert.equal(staticOpacity(0.9, STATIC.hold, STATIC.fade), 0);
});

test('the dark-mode opening fades from the splash colour to cream first', () => {
  const st = PHONES['iPhone 13'];
  const s = (t: number) => sceneAt(FULL, t, st, PARTS.full, PARTS.bubbles, 0, 0.25, FADE_LEVELS);
  assert.equal(s(-0.25).bgCream, 0);
  assert.ok(Math.abs(s(-0.125).bgCream - 0.5) < 1e-9);
  assert.equal(s(0).bgCream, 1);
  assert.equal(s(-0.1).potOpacity, 0, 'nothing on the dark');
});

test('frame stats: average, worst and frames slower than 55fps', () => {
  const st = frameStats([16.7, 16.7, 16.6, 33.4, 16.6]);
  assert.equal(st.frames, 5);
  assert.equal(st.worstFps, 30);
  assert.equal(st.slow, 1);
  assert.equal(frameStats([]).frames, 0);
});
