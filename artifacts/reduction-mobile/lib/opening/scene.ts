/**
 * lib/opening/scene.ts — the opening sequence as a pure function of time.
 *
 * `sceneAt(timeline, t, stage, pour, bubbles, hold, pre)` returns everything
 * drawn at time t: path strings and a handful of numbers. It runs on the UI
 * thread (every function here carries 'worklet', inert under the test
 * runner), so the JS thread does no per-frame work; and it is pure, so any
 * frame can be tested and a scrubbed frame is the same frame the phone
 * draws.
 *
 * Coordinates are the prototype's: the artwork's 1024-wide square sits in a
 * 1024 x 2160 scene (viewBox 0 -568 1024 2160, a 9:19 screen), scaled to
 * COVER the real screen (`stageFor`). The camera is applied here, to the
 * numbers, rather than as an animated transform — so every animated prop is
 * a path string, an opacity or a width, the props react-native-svg updates
 * most directly.
 *
 * The pot is the artwork's pot. At rest (tilt 0) its outline IS the icon's
 * path: the icon's quadratic corners are written as the cubics they equal
 * (control points 2/3 of the way to the corner), and as the camera rises
 * those controls move to a circle's 0.5523, the prototype's arcs, while the
 * wall foreshortens (`tiltGeo`). The wall never fades; it flattens under the
 * rim, and only when there is nothing left of it (tilt > 0.995) is it
 * dropped.
 */

import type { Timeline } from './config';
import type { Bubble, Pour } from './particles';
import { SPICE_COLOURS, bottleAngle, shakerAngle } from './particles';

export const SCENE = { x: 0, y: -568, w: 1024, h: 2160 } as const;
export const VIEWBOX = `${SCENE.x} ${SCENE.y} ${SCENE.w} ${SCENE.h}`;
/** The prototype's half-diagonal, in scene units: every size that has to
 *  cover the screen is scaled from it by the real screen's. */
const PROTO_HD = 0.5 * Math.hypot(SCENE.w, SCENE.h);
/** Prototype: the interior ends 5.6x the size, and the reveal's circle
 *  ends at 300px on its 240px-wide stage. */
const PROTO_ZOOM = 5.6;
const PROTO_REVEAL = (300 * SCENE.w) / 240;
/** The ring at the reveal's edge: 5px on the 240px stage. */
export const RING_W = (5 * SCENE.w) / 240;
export const RIPPLE_LIFE = 0.55;

export interface Stage {
  w: number;
  h: number;
  /** Points per scene unit (cover). */
  k: number;
  /** Where scene (0, 0) lands on the screen. */
  ox: number;
  oy: number;
  /** The screen's half-diagonal in scene units. */
  hd: number;
  zoomEnd: number;
  revealMax: number;
}

export function stageFor(w: number, h: number): Stage {
  const k = Math.max(w / SCENE.w, h / SCENE.h);
  const hd = 0.5 * Math.hypot(w / k, h / k);
  return {
    w,
    h,
    k,
    ox: (w - SCENE.w * k) / 2 - SCENE.x * k,
    oy: (h - SCENE.h * k) / 2 - SCENE.y * k,
    hd,
    // The interior (radius 240 once it faces the camera) must cover the
    // screen's half-diagonal with the prototype's margin, on any screen.
    zoomEnd: (PROTO_ZOOM * hd) / PROTO_HD,
    revealMax: (PROTO_REVEAL * hd) / PROTO_HD,
  };
}

/** Scene point to screen point. */
export function toScreen(st: Stage, x: number, y: number) {
  'worklet';
  return { x: st.ox + x * st.k, y: st.oy + y * st.k };
}

export interface Placed { x: number; y: number; rot: number; scale: number; opacity: number }

export interface Scene {
  /** 0 = the dark splash colour, 1 = cream: the dark-mode opening. */
  bgCream: number;
  /** The cream background; off once the reveal has begun (the interior
   *  covers the screen by then, and the hole must show the app). */
  bgOn: boolean;
  potOpacity: number;
  handles: [string, string];
  body: string;
  bodyOpacity: number;
  rim: string;
  inner: string;
  /** The liquid's outline, which clips the ripples and the bubbles. */
  liquid: string;
  /** Index kind·L + level: kind 0 = spice ripples, 1 = drop ripples. */
  ripples: string[];
  rippleWidth: number;
  /** By fade level. */
  bubbles: string[];
  bubbleWidth: number;
  /** By SPICE_COLOURS. */
  spice: [string, string, string];
  drops: string;
  shaker: Placed;
  bottle: Placed;
  /** Everything OUTSIDE the reveal circle (even-odd), the scene's clip. */
  hole: string;
  ringR: number;
  ringOpacity: number;
  /** Numbers for tests and the renderer's switches. */
  tilt: number;
  zoom: number;
  reveal: number;
  revealR: number;
  done: boolean;
}

// ——— easing, the prototype's ———

export function cl(x: number) {
  'worklet';
  return Math.max(0, Math.min(1, x));
}
export function eio(x: number) {
  'worklet';
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
export function eo(x: number) {
  'worklet';
  return 1 - Math.pow(1 - x, 3);
}
function n(v: number) {
  'worklet';
  return Math.round(v * 10) / 10;
}

// ——— the pot's foreshortening (the prototype's tiltGeo) ———

const PH0 = Math.asin(40 / 274);
const SN0 = 40 / 274;
const CS0 = Math.cos(PH0);

export interface TiltGeo { ryR: number; ryI: number; A: number; yb: number; c: number; hf: number; s2: number; handleY: number }

/** tt 0: the icon's pot, seen from the side. tt 1: looking straight down
 *  into it — the rim and the liquid are circles and the wall has no height. */
export function tiltGeo(tt: number): TiltGeo {
  'worklet';
  const phi = PH0 + (Math.PI / 2 - PH0) * tt;
  const sn = Math.sin(phi);
  const s2 = (sn - SN0) / (1 - SN0);
  const hf = Math.cos(phi) / CS0;
  const ryR = 40 + 234 * s2;
  const A = 622 + ryR;
  return { ryR, ryI: 27 + 213 * s2, A, yb: A + 246 * hf, c: 90 + 184 * s2, hf, s2, handleY: 599 + 51 * hf };
}

interface Cam { s: number; ty: number }
function cx_(v: number, cam: Cam) {
  'worklet';
  return 512 + (v - 512) * cam.s;
}
function cy_(v: number, cam: Cam) {
  'worklet';
  return cam.ty + (v - 626) * cam.s;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number, cam: Cam) {
  'worklet';
  const X = cx_(cx, cam);
  const Y = cy_(cy, cam);
  const a = Math.max(0.05, rx * cam.s);
  const b = Math.max(0.05, ry * cam.s);
  return `M${n(X - a)} ${n(Y)}a${n(a)} ${n(b)} 0 1 0 ${n(2 * a)} 0a${n(a)} ${n(b)} 0 1 0 ${n(-2 * a)} 0Z`;
}

/** A rounded rectangle whose corners may be elliptical (a bar squashed by
 *  the foreshortening keeps round ends that flatten with it). */
export function roundRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number, cam: Cam) {
  'worklet';
  const X = cx_(x, cam);
  const Y = cy_(y, cam);
  const W = w * cam.s;
  const H = Math.max(0, h * cam.s);
  const a = Math.min(rx * cam.s, W / 2);
  const b = Math.min(ry * cam.s, H / 2);
  if (H < 0.05) return '';
  return (
    `M${n(X + a)} ${n(Y)}H${n(X + W - a)}A${n(a)} ${n(b)} 0 0 1 ${n(X + W)} ${n(Y + b)}` +
    `V${n(Y + H - b)}A${n(a)} ${n(b)} 0 0 1 ${n(X + W - a)} ${n(Y + H)}` +
    `H${n(X + a)}A${n(a)} ${n(b)} 0 0 1 ${n(X)} ${n(Y + H - b)}` +
    `V${n(Y + b)}A${n(a)} ${n(b)} 0 0 1 ${n(X + a)} ${n(Y)}Z`
  );
}

/** The pot's wall. At g = tiltGeo(0) this is the icon's body path exactly
 *  (cubic corners equal to its quadratic ones); see the file header. */
export function bodyPath(g: TiltGeo, cam: Cam) {
  'worklet';
  const P = (x: number, y: number) => `${n(cx_(x, cam))} ${n(cy_(y, cam))}`;
  const k = 2 / 3 + (0.5523 - 2 / 3) * g.s2;
  const c = g.c;
  const yb = g.yb;
  // The straight part of the side ends where the corner begins; below the
  // top corners it cannot rise, so a deep corner turns elliptical instead.
  const top = Math.max(652, yb - c);
  const cv = yb - top;
  return (
    `M${P(270, 620)}H${n(cx_(754, cam))}Q${P(786, 620)} ${P(786, 652)}V${n(cy_(top, cam))}` +
    `C${P(786, top + k * cv)} ${P(786 - c + k * c, yb)} ${P(786 - c, yb)}` +
    `H${n(cx_(238 + c, cam))}` +
    `C${P(238 + c - k * c, yb)} ${P(238, top + k * cv)} ${P(238, top)}` +
    `V${n(cy_(652, cam))}Q${P(238, 620)} ${P(270, 620)}Z`
  );
}

const DROP_W = 20;
function dropPath(dx: number, dy: number, sx: number, sy: number, cam: Cam) {
  'worklet';
  const P = (x: number, y: number) => `${n(cx_(dx + x * sx, cam))} ${n(cy_(dy + y * sy, cam))}`;
  const rx = n(DROP_W * sx * cam.s);
  const ry = n(DROP_W * sy * cam.s);
  return `M${P(0, -26)}C${P(12, -6)} ${P(20, 6)} ${P(20, 18)}A${rx} ${ry} 0 1 1 ${P(-20, 18)}C${P(-20, 6)} ${P(-12, -6)} ${P(0, -26)}Z`;
}

/** Everything but a circle of radius r at the screen's centre — as an
 *  even-odd path, the reveal's hole. */
export function holePath(r: number) {
  'worklet';
  const outer = 'M-4000 -5000H5024V6000H-4000Z';
  if (r <= 0.05) return outer;
  return `${outer}M${n(512 - r)} 512a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function level(op: number, L: number) {
  'worklet';
  return Math.max(0, Math.min(L - 1, Math.ceil(op * L) - 1));
}

export function sceneAt(C: Timeline, x: number, st: Stage, P: Pour, B: Bubble[], hold: number, pre: number, L: number): Scene {
  'worklet';
  const tt = eio(cl((x - C.tilt[0]) / (C.tilt[1] - C.tilt[0])));
  const zs = eio(cl((x - C.zoom[0]) / (C.zoom[1] - C.zoom[0])));
  const cam: Cam = { s: Math.exp(Math.log(st.zoomEnd) * zs), ty: 626 + (512 - 626) * zs };
  const g = tiltGeo(tt);

  const handles: [string, string] = [
    roundRectPath(214, g.handleY, 60, 46, 22, 22, cam),
    roundRectPath(750, g.handleY, 60, 46, 22, 22, cam),
  ];
  // The pour.
  const spice: [string, string, string] = ['', '', ''];
  for (let i = 0; i < P.spice.length; i++) {
    const p = P.spice[i];
    const u = (x - p.ts) / p.dur;
    if (u < 0 || u >= 1) continue;
    const ci = p.c === SPICE_COLOURS[0] ? 0 : p.c === SPICE_COLOURS[1] ? 1 : 2;
    spice[ci] += ellipsePath(p.x0 + (p.xl - p.x0) * u, p.y0 + (p.yl - p.y0) * Math.pow(u, 1.5), p.r, p.r, cam);
  }
  let drops = '';
  for (let i = 0; i < P.drops.length; i++) {
    const d = P.drops[i];
    const u = (x - d.ts) / d.dur;
    if (u < 0 || u >= 1) continue;
    drops += dropPath(d.x0 + (d.xl - d.x0) * u, d.y0 + (d.yl - d.y0) * Math.pow(u, 1.5), d.s, d.s * 1.15, cam);
  }

  // On the surface.
  const ripples: string[] = [];
  for (let i = 0; i < 2 * L; i++) ripples.push('');
  for (let i = 0; i < P.ripples.length; i++) {
    const r = P.ripples[i];
    const age = (x - r.tl) / RIPPLE_LIFE;
    if (age < 0 || age >= 1) continue;
    const rx = r.b + r.g * age;
    const j = (r.kind === 'spice' ? 0 : L) + level(1 - age, L);
    ripples[j] += ellipsePath(r.x, 626 + r.v * g.ryI, rx, rx * (0.28 + 0.72 * tt), cam);
  }
  const bubbles: string[] = [];
  for (let i = 0; i < L; i++) bubbles.push('');
  // A held reveal keeps the pot bubbling while everything else waits.
  const xb = x + hold;
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (xb < C.bubS + b.off) continue;
    const ph = ((xb - C.bubS - b.off) % b.L) / b.L;
    let rd: number;
    let op: number;
    if (ph < 0.8) {
      rd = b.rm * eo(ph / 0.8);
      op = 1;
    } else {
      const q = (ph - 0.8) / 0.2;
      rd = b.rm * (1 + 0.25 * q);
      op = 1 - q;
    }
    if (op <= 0 || rd <= 0.05) continue;
    bubbles[level(op, L)] += ellipsePath(512 + b.u * 240, 626 + b.v * g.ryI, rd, rd * (0.35 + 0.65 * tt), cam);
  }

  // The shaker and the bottle.
  const ein = eo(cl((x - C.shIn[0]) / (C.shIn[1] - C.shIn[0])));
  const eout = eio(cl((x - C.out[0]) / (C.out[1] - C.out[0])));
  const sa = shakerAngle(x, C);
  const ba = bottleAngle(x, C);
  const place = (px: number, py: number, rot: number): Placed => ({
    x: cx_(px, cam),
    y: cy_(py, cam),
    rot,
    scale: cam.s,
    opacity: ein * (1 - eout),
  });

  const rv = eio(cl((x - C.rev[0]) / (C.rev[1] - C.rev[0])));
  const R = rv * st.revealMax;

  return {
    bgCream: pre > 0 ? cl((x + pre) / pre) : 1,
    bgOn: rv <= 0,
    potOpacity: eo(cl(x / 0.4)),
    handles,
    body: bodyPath(g, cam),
    bodyOpacity: tt > 0.995 ? 0 : 1,
    rim: ellipsePath(512, 622, 274, g.ryR, cam),
    inner: ellipsePath(512, 626, 240, g.ryI, cam),
    liquid: ellipsePath(512, 626, 240, g.ryI, cam),
    ripples,
    rippleWidth: 3 * cam.s,
    bubbles,
    bubbleWidth: 2.5 * cam.s,
    spice,
    drops,
    shaker: place(290 - 90 * (1 - ein) - 140 * eout, 262 - 120 * (1 - ein) - 120 * eout, sa.th),
    bottle: place(735 + 90 * (1 - ein) + 140 * eout, 250 - 120 * (1 - ein) - 120 * eout, ba.th),
    hole: holePath(rv >= 1 ? st.revealMax : R),
    ringR: Math.max(0, R - RING_W / 2),
    ringOpacity: rv > 0 && rv < 1 ? 1 - rv * rv : 0,
    tilt: tt,
    zoom: cam.s,
    reveal: rv,
    revealR: R,
    done: x >= C.total,
  };
}

// ——— the clock ———

export interface Clock { t: number; hold: number }

/**
 * One frame of the timeline. Time runs at the frame's pace (a long frame
 * counts as at most 50ms, so a hitch slows the sequence rather than
 * skipping it). If the reveal comes due before the app underneath is
 * ready, time stops on the frame before it while `hold` keeps the bubbles
 * moving, for up to `maxHold` seconds; then the reveal goes anyway.
 */
export function advance(c: Clock, dtSec: number, ready: boolean, revStart: number, total: number, maxHold: number): Clock {
  'worklet';
  const dt = Math.min(0.05, Math.max(0, dtSec));
  if (c.t >= total) return c;
  if (c.t < revStart) {
    const t = c.t + dt;
    if (t < revStart || ready) return { t: Math.min(t, total), hold: c.hold };
    return { t: revStart, hold: Math.min(maxHold, c.hold + (t - revStart)) };
  }
  if (c.t === revStart && !ready && c.hold < maxHold) return { t: revStart, hold: Math.min(maxHold, c.hold + dt) };
  return { t: Math.min(total, c.t + dt), hold: c.hold };
}

/** Reduce Motion's still: full opacity, then a crossfade out. */
export function staticOpacity(x: number, holdS: number, fadeS: number) {
  'worklet';
  return 1 - cl((x - holdS) / fadeS);
}

// ——— the frame-rate readout ———

export interface FrameStats { frames: number; avgFps: number; worstFps: number; slow: number; seconds: number }

/** From each frame's duration in ms. `slow` counts frames longer than a
 *  55fps frame (18.2ms) — the kill criterion's line. */
export function frameStats(deltasMs: number[]): FrameStats {
  const ds = deltasMs.filter((d) => d > 0);
  if (!ds.length) return { frames: 0, avgFps: 0, worstFps: 0, slow: 0, seconds: 0 };
  const total = ds.reduce((a, b) => a + b, 0);
  const worst = Math.max(...ds);
  return {
    frames: ds.length,
    avgFps: Math.round((1000 * ds.length) / total),
    worstFps: Math.round(1000 / worst),
    slow: ds.filter((d) => d > 1000 / 55).length,
    seconds: Math.round(total) / 1000,
  };
}
