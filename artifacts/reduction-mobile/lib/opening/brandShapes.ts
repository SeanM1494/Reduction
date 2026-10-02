/**
 * lib/opening/brandShapes.ts — brand/opening/opening-scene.svg as data.
 *
 * That file is the app icon as it was until Oct 2 2026, when the icon became
 * the plain pot with steam (brand/reduction-icon.svg). The opening sequence
 * still pours from this scene, so it keeps its own source rather than
 * following the icon.
 *
 * The opening sequence has to move the shaker, the bottle and the pot's
 * parts separately, so it cannot be an image of the artwork the way the
 * sign-in mark is. These are the artwork's own elements and numbers, in the
 * file's order; `brandShapes.test.ts` parses brand/opening/opening-scene.svg and
 * fails on any difference, so an edit to that scene fails here until this
 * file follows it. Nothing here is drawn by eye.
 */

export type BrandEl =
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill?: string; opacity?: number; clip?: string }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string }
  | { tag: 'path'; d: string; fill?: string; transform?: string };

export const CREAM = '#efe2c8';

/** The pot, at rest (the icon's own pose). */
export const POT = {
  handleFill: '#7a2a1e',
  handles: [
    { x: 214, y: 650, width: 60, height: 46, rx: 22 },
    { x: 750, y: 650, width: 60, height: 46, rx: 22 },
  ],
  body: {
    d: 'M270 620 H754 Q786 620 786 652 V818 Q786 908 696 908 H328 Q238 908 238 818 V652 Q238 620 270 620 Z',
    fill: '#b23a2a',
  },
  rim: { cx: 512, cy: 622, rx: 274, ry: 40, fill: '#8a2c20' },
  inner: { cx: 512, cy: 626, rx: 240, ry: 27, fill: '#3f1712' },
  bars: [
    { x: 399, y: 720, width: 34, height: 130, rx: 17, fill: '#f1dfc2' },
    { x: 463, y: 752, width: 34, height: 98, rx: 17, fill: '#deae94' },
    { x: 527, y: 782, width: 34, height: 68, rx: 17, fill: '#cd7f6a' },
    { x: 591, y: 810, width: 34, height: 40, rx: 17, fill: '#bd5845' },
  ],
  /** What already floats in the pot in the icon: the vinegar slick and
   *  three flecks of spice. The still (Reduce Motion) frame shows them; the
   *  animation starts with an empty pot and fills it. */
  slick: { cx: 566, cy: 628, rx: 24, ry: 7, fill: '#e0a23a' },
  flecks: [
    { cx: 456, cy: 620, r: 8, fill: '#cf5a26' },
    { cx: 484, cy: 632, r: 6, fill: '#6f8f55' },
    { cx: 430, cy: 630, r: 6, fill: '#a9431b' },
  ],
} as const;

/** The icon's frozen pour: the spice stream and the vinegar drops. */
export const STREAM = [
  { cx: 398, cy: 370, r: 10, fill: '#cf5a26' },
  { cx: 412, cy: 406, r: 8, fill: '#a9431b' },
  { cx: 420, cy: 446, r: 11, fill: '#cf5a26' },
  { cx: 438, cy: 484, r: 8, fill: '#cf5a26' },
  { cx: 450, cy: 524, r: 10, fill: '#a9431b' },
  { cx: 468, cy: 562, r: 8, fill: '#cf5a26' },
  { cx: 430, cy: 426, r: 6, fill: '#6f8f55' },
  { cx: 456, cy: 502, r: 7, fill: '#6f8f55' },
] as const;

export const DROP_D = 'M0 -26 C 12 -6 20 6 20 18 A20 20 0 1 1 -20 18 C -20 6 -12 -6 0 -26 Z';
export const DROP_FILL = '#e0a23a';
export const DROPS = [
  { x: 594, y: 386, s: 0.85 },
  { x: 584, y: 440, s: 0.95 },
  { x: 575, y: 494, s: 0.85 },
  { x: 567, y: 548, s: 0.72 },
] as const;

/** The shaker, in its own coordinates; the icon places it at
 *  translate(290 262) rotate(132). */
export const SHAKER = {
  at: { x: 290, y: 262, rotate: 132 },
  clip: { x: -64, y: -58, width: 128, height: 170, rx: 28 },
  els: [
    { tag: 'rect', x: -64, y: -58, width: 128, height: 170, rx: 28, fill: '#a9cbbd' },
    { tag: 'rect', x: -64, y: -58, width: 128, height: 100, fill: '#cf5a26', clip: 'jar' },
    { tag: 'rect', x: -46, y: -28, width: 12, height: 112, rx: 6, fill: '#ffffff', opacity: 0.5 },
    { tag: 'rect', x: -56, y: -112, width: 112, height: 58, rx: 14, fill: '#6b5e50' },
    { tag: 'rect', x: -56, y: -66, width: 112, height: 12, fill: '#54493d' },
    { tag: 'circle', cx: -24, cy: -92, r: 7, fill: '#3f352b' },
    { tag: 'circle', cx: 0, cy: -92, r: 7, fill: '#3f352b' },
    { tag: 'circle', cx: 24, cy: -92, r: 7, fill: '#3f352b' },
  ] as BrandEl[],
  /** Half the side of a square about the shaker's own origin that holds
   *  all of it, at any rotation (its farthest corner is ~130 away). */
  extent: 140,
} as const;

const BOTTLE_D = 'M -20 -140 V -72 C -20 -50 -70 -46 -70 -6 V 118 Q -70 150 -38 150 H 38 Q 70 150 70 118 V -6 C 70 -46 20 -50 20 -72 V -140 Z';

/** The vinegar bottle; the icon places it at translate(735 250) rotate(-128). */
export const BOTTLE = {
  at: { x: 735, y: 250, rotate: -128 },
  clipD: BOTTLE_D,
  els: [
    { tag: 'path', d: BOTTLE_D, fill: '#b9772e' },
    { tag: 'rect', x: -70, y: -100, width: 140, height: 150, fill: '#e0a23a', clip: 'bottle' },
    { tag: 'rect', x: -54, y: -20, width: 10, height: 64, rx: 5, fill: '#ffffff', opacity: 0.35 },
    { tag: 'rect', x: -46, y: 40, width: 92, height: 66, rx: 10, fill: '#f6ecd6' },
    { tag: 'rect', x: -28, y: 58, width: 56, height: 9, rx: 4.5, fill: '#b23a2a' },
    { tag: 'rect', x: -20, y: 78, width: 40, height: 9, rx: 4.5, fill: '#b9772e' },
    { tag: 'rect', x: -30, y: -160, width: 60, height: 22, rx: 9, fill: '#7a4a1c' },
  ] as BrandEl[],
  /** Its farthest point from its own origin is ~165 away. */
  extent: 175,
} as const;
