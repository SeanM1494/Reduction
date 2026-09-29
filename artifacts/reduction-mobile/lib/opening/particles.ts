/**
 * lib/opening/particles.ts — every particle, drop, ripple and bubble, from
 * one fixed seed, so the sequence plays identically every time and can be
 * tested frame by frame.
 *
 * PURE. The draws happen in the prototype's order (Full's pour, Quick's
 * pour, then the bubbles) from the prototype's generator (Park–Miller,
 * seed 7), so the same seed yields the prototype's exact positions. Change
 * the order of a single draw and every particle after it moves.
 */

import { BUBBLES, FULL, QUICK, type Timeline } from './config';

export interface Spice { ts: number; dur: number; x0: number; y0: number; xl: number; yl: number; r: number; c: string }
export interface Drop { ts: number; dur: number; x0: number; y0: number; xl: number; yl: number; s: number }
/** A ring on the surface where something landed: `b` + `g`·age is its
 *  radius, `v` its place across the surface (−0.55..0.55 of the depth). */
export interface Ripple { tl: number; x: number; v: number; b: number; g: number; kind: 'spice' | 'drop' }
export interface Bubble { u: number; v: number; rm: number; L: number; off: number }
export interface Pour { spice: Spice[]; drops: Drop[]; ripples: Ripple[] }

export const SPICE_COLOURS = ['#cf5a26', '#a9431b', '#6f8f55'] as const;

export function generator(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** The shaker's angle as it tips in (and its shake while pouring). */
export function shakerAngle(x: number, C: Timeline) {
  'worklet';
  const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, (x - C.shIn[0]) / (C.shIn[1] - C.shIn[0]))), 3);
  return { th: 60 + 72 * e + (x > C.shIn[1] ? 3 * Math.sin(x * 38) : 0), e };
}

/** The bottle's angle as it tips in (and its slower sway). */
export function bottleAngle(x: number, C: Timeline) {
  'worklet';
  const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, (x - C.shIn[0]) / (C.shIn[1] - C.shIn[0]))), 3);
  return { th: -60 - 68 * e + (x > C.shIn[1] ? 1.5 * Math.sin(x * 7) : 0), e };
}

function pour(C: Timeline, rnd: () => number): Pour {
  const spice: Spice[] = [];
  const drops: Drop[] = [];
  const ripples: Ripple[] = [];
  for (let n = 0; n < C.nSp; n++) {
    const ts = C.spiceS + n * C.spInt;
    const a = shakerAngle(ts, C);
    const rad = (a.th * Math.PI) / 180;
    const v = (rnd() - 0.5) * 1.1;
    // Two draws only when the first misses: the prototype's short-circuit.
    const c = rnd() < 0.22 ? '#6f8f55' : rnd() < 0.4 ? '#a9431b' : '#cf5a26';
    const xl = 430 + rnd() * 70;
    spice.push({
      ts,
      dur: C.spDur,
      x0: 290 - 90 * (1 - a.e) + 112 * Math.sin(rad) + (rnd() - 0.5) * 12,
      y0: 262 - 120 * (1 - a.e) - 112 * Math.cos(rad) + (rnd() - 0.5) * 8,
      xl,
      yl: 626 + v * 27,
      r: 6 + rnd() * 5,
      c,
    });
    ripples.push({ tl: ts + C.spDur, x: xl, v, b: 5, g: 34, kind: 'spice' });
  }
  for (let n = 0; n < C.nDr; n++) {
    const td = C.dropS + n * C.drInt;
    const bb = bottleAngle(td, C);
    const rb = (bb.th * Math.PI) / 180;
    const vd = (rnd() - 0.5) * 1.1;
    const d: Drop = {
      ts: td,
      dur: C.drDur,
      x0: 735 + 90 * (1 - bb.e) + 158 * Math.sin(rb) - 8,
      y0: 250 - 120 * (1 - bb.e) - 158 * Math.cos(rb) + 24,
      xl: 552 + rnd() * 36,
      yl: 626 + vd * 27,
      s: 0.8 + rnd() * 0.2,
    };
    drops.push(d);
    ripples.push({ tl: td + C.drDur, x: d.xl, v: vd, b: 8, g: 48, kind: 'drop' });
  }
  return { spice, drops, ripples };
}

export interface Particles { full: Pour; quick: Pour; bubbles: Bubble[] }

export function makeParticles(seed = 7, counts: { large: number; small: number } = BUBBLES): Particles {
  const rnd = generator(seed);
  const full = pour(FULL, rnd);
  const quick = pour(QUICK, rnd);
  const bubbles: Bubble[] = [];
  // Always draw the prototype's 26 + 18, so cutting the count for speed
  // keeps the SAME bubbles (the first ones) rather than new positions.
  for (let i = 0; i < 26; i++) {
    const an = rnd() * 6.283;
    const rr = Math.sqrt(rnd()) * 0.82;
    const b = { u: Math.cos(an) * rr, v: Math.sin(an) * rr * 0.9, rm: 9 + rnd() * 20, L: 0.9 + rnd() * 0.8, off: rnd() * 1.4 };
    if (i < counts.large) bubbles.push(b);
  }
  for (let i = 0; i < 18; i++) {
    const an = rnd() * 6.283;
    const rr = Math.sqrt(rnd()) * 0.85;
    const b = { u: Math.cos(an) * rr, v: Math.sin(an) * rr * 0.9, rm: 3 + rnd() * 4, L: 0.5 + rnd() * 0.5, off: rnd() * 0.9 };
    if (i < counts.small) bubbles.push(b);
  }
  return { full, quick, bubbles };
}
