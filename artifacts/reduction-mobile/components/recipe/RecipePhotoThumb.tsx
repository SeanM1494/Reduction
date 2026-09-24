/**
 * components/recipe/RecipePhotoThumb.tsx — the recipe's picture on the
 * recipe screen, beside the servings stepper (ServingsRow's `aside`).
 *
 * Sized from the screen, not fixed: the stepper row (MAKING, then three 44pt
 * cells) needs about 212pt beside it, and on an iPhone SE that leaves 68pt —
 * the height the servings block already has, so the photo costs the SE's
 * budgeted headroom nothing (CLAUDE.md, "~240px of headroom"). Wider phones
 * get a bigger picture, up to 128pt, which they have the room for.
 *
 * A decoration: no photo means nothing at all here, not a placeholder — the
 * meal-type art is the book's and the grid's fallback, and on this screen
 * the diagram is what the space is for. Hidden from screen readers for the
 * same reason; the title already says what the dish is.
 */

import React from 'react';
import { Image, StyleSheet, useWindowDimensions } from 'react-native';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { useColors } from '@/hooks/useColors';
import type { Entry } from '@/lib/api';

const PAGE_GUTTERS = 40; // RecipeScreen's scrollContent: 20 each side
const STEPPER_ROW = 200; // MAKING + gap + the three-cell stepper, measured
const GAP = 12; // ServingsRow's gap before the aside
const MIN = 64;
const MAX = 128;

export const thumbSize = (screenW: number): number =>
  Math.round(Math.max(MIN, Math.min(MAX, screenW - PAGE_GUTTERS - STEPPER_ROW - GAP)));

export function RecipePhotoThumb({ entry }: { entry: Pick<Entry, 'id' | 'photo' | 'recipe'> }) {
  const photo = useRecipePhoto(entry);
  const colors = useColors();
  const { width } = useWindowDimensions();
  if (!photo) return null;
  const size = thumbSize(width);
  return (
    <Image
      source={photo}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.photo, { width: size, height: size, borderRadius: colors.radius, backgroundColor: colors.muted }]}
      testID="recipe-photo"
    />
  );
}

const styles = StyleSheet.create({
  photo: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)' },
});
