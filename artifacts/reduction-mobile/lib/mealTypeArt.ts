/**
 * lib/mealTypeArt.ts — what a card shows when a recipe has no picture: a
 * kitchen sketch (lib/sketchData.ts) for its primary meal type, drawn in the
 * colour of the book it sits in on a pale wash of that colour, so a card
 * without a photo reads as designed rather than broken (Oct 8; before that a
 * Feather glyph on a meal-type tint, which clashed with the book around it).
 *
 * TWO sketches per meal type, and which one a recipe gets is a function of
 * its id alone, so it never changes between renders or devices. A custom
 * book has no meal type of its own: its recipes keep their own sketches in
 * the book's colour (Sean chose this over a per-book emblem, Oct 8). The
 * meal-type tint below is only the colour for a face that has no book (the
 * starter reel's cards). Pure and tested so every meal type has two sketches
 * that exist.
 */

import { MEAL_TYPES, type MealType } from '@workspace/recipe-model';

export interface MealTypeArt {
  light: { bg: string; ink: string };
  dark: { bg: string; ink: string };
}

const ART: Record<MealType | 'untagged', MealTypeArt> = {
  breakfast: { light: { bg: '#fbe3bf', ink: '#8a5a12' }, dark: { bg: '#4a3a1c', ink: '#f2c97a' } },
  lunch: { light: { bg: '#f4e7b3', ink: '#7a6410' }, dark: { bg: '#463e18', ink: '#e8d372' } },
  dinner: { light: { bg: '#f9d6cf', ink: '#8c2a1e' }, dark: { bg: '#4d2620', ink: '#f0a79a' } },
  dessert: { light: { bg: '#f3d6e3', ink: '#8a2d5c' }, dark: { bg: '#4a2538', ink: '#eba5c8' } },
  snack: { light: { bg: '#eaeedd', ink: '#5b6d47' }, dark: { bg: '#2f3a26', ink: '#b9cc9c' } },
  side: { light: { bg: '#e2ead4', ink: '#4b6b3a' }, dark: { bg: '#2a3a24', ink: '#aacb92' } },
  drink: { light: { bg: '#d9e6ea', ink: '#2f5c6b' }, dark: { bg: '#213a42', ink: '#9ccbd8' } },
  baking: { light: { bg: '#efe0c8', ink: '#7a5528' }, dark: { bg: '#44341f', ink: '#e0be8c' } },
  // A brighter leaf green than snack's olive and side's sage: three greens
  // in the palette, and this one must not read as either.
  salad: { light: { bg: '#d9efd3', ink: '#2f7a3b' }, dark: { bg: '#1f3a24', ink: '#9fdca7' } },
  untagged: { light: { bg: '#f7f0df', ink: '#6b6154' }, dark: { bg: '#3a342c', ink: '#b3a898' } },
};

/** The two sketches of each meal type, keys of SKETCHES. */
const SKETCH_KEYS: Record<MealType | 'untagged', readonly [string, string]> = {
  breakfast: ['pancakes', 'egg'],
  lunch: ['sandwich', 'soup'],
  dinner: ['pot', 'skillet'],
  dessert: ['cake', 'cupcake'],
  snack: ['cheese', 'skewer'],
  side: ['corn', 'carrot'],
  drink: ['mug', 'glass'],
  baking: ['loaf', 'rollingpin'],
  salad: ['saladbowl', 'tomato'],
  untagged: ['whisk', 'openbook'],
};

/** FNV-1a, so the choice is the same on every device and every render. */
function hashOf(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Which of a meal type's two sketches this recipe gets. */
export function sketchKeyFor(type: MealType | null | undefined, seed: string): string {
  const pair = SKETCH_KEYS[(type && type in SKETCH_KEYS ? type : 'untagged') as MealType | 'untagged'];
  return pair[hashOf(seed) % 2];
}

export const ALL_SKETCH_KEYS: readonly string[] = Object.values(SKETCH_KEYS).flat();

function mix(a: string, b: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) => Math.round(n(a, i) * t + n(b, i) * (1 - t)).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

/**
 * The drawing's ink and the wash behind it, from a book's colour. Light is
 * the cream page (the book colour as is, a 14% wash of it on the paper);
 * dark is for a dark surface, where the ink is lifted toward cream.
 */
export function sketchColors(color: string, tone: 'light' | 'dark'): { bg: string; ink: string } {
  return tone === 'dark'
    ? { bg: mix(color, '#3b2f28', 0.3), ink: mix(color, '#f6eedd', 0.55) }
    : { bg: mix(color, '#fbf6ea', 0.14), ink: color };
}

export function mealTypeArt(type: MealType | null | undefined): MealTypeArt {
  return (type && ART[type]) || ART.untagged;
}

/** Every meal type the model knows has art — the test pins it. */
export const MEAL_TYPES_WITH_ART: readonly string[] = MEAL_TYPES.filter((t) => t in ART);
