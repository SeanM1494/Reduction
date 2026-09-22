/**
 * lib/mealTypeArt.ts — what a card shows when a recipe has no picture: a
 * glyph on a tint keyed to its primary meal type, so a card without a photo
 * reads as designed rather than broken. Pure and tested so every meal type
 * the model knows has an entry; the glyph names are Feather icons
 * (@expo/vector-icons), the tints sit inside the app's palette.
 */

import { MEAL_TYPES, type MealType } from '@workspace/recipe-model';

export interface MealTypeArt {
  /** Feather icon name. */
  icon: string;
  light: { bg: string; ink: string };
  dark: { bg: string; ink: string };
}

const ART: Record<MealType | 'untagged', MealTypeArt> = {
  breakfast: { icon: 'sunrise', light: { bg: '#fbe3bf', ink: '#8a5a12' }, dark: { bg: '#4a3a1c', ink: '#f2c97a' } },
  lunch: { icon: 'sun', light: { bg: '#f4e7b3', ink: '#7a6410' }, dark: { bg: '#463e18', ink: '#e8d372' } },
  dinner: { icon: 'moon', light: { bg: '#f9d6cf', ink: '#8c2a1e' }, dark: { bg: '#4d2620', ink: '#f0a79a' } },
  dessert: { icon: 'gift', light: { bg: '#f3d6e3', ink: '#8a2d5c' }, dark: { bg: '#4a2538', ink: '#eba5c8' } },
  snack: { icon: 'package', light: { bg: '#eaeedd', ink: '#5b6d47' }, dark: { bg: '#2f3a26', ink: '#b9cc9c' } },
  side: { icon: 'layers', light: { bg: '#e2ead4', ink: '#4b6b3a' }, dark: { bg: '#2a3a24', ink: '#aacb92' } },
  drink: { icon: 'coffee', light: { bg: '#d9e6ea', ink: '#2f5c6b' }, dark: { bg: '#213a42', ink: '#9ccbd8' } },
  baking: { icon: 'box', light: { bg: '#efe0c8', ink: '#7a5528' }, dark: { bg: '#44341f', ink: '#e0be8c' } },
  untagged: { icon: 'book-open', light: { bg: '#f7f0df', ink: '#6b6154' }, dark: { bg: '#3a342c', ink: '#b3a898' } },
};

export function mealTypeArt(type: MealType | null | undefined): MealTypeArt {
  return (type && ART[type]) || ART.untagged;
}

/** Every meal type the model knows has art — the test pins it. */
export const MEAL_TYPES_WITH_ART: readonly string[] = MEAL_TYPES.filter((t) => t in ART);
