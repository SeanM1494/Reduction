/**
 * components/recipeBox/PageFace.tsx — a recipe as a Recipe Box page draws
 * it: the picture (or its meal-type art), the title, the stated time (or no
 * line at all), serves and steps, the first few ingredients, and a footer
 * the caller chooses. The book's pages (BookPage.tsx) and the starter
 * reel's cards (components/reel) are both this face, so the two can never
 * drift into two looks; what each SAYS is decided elsewhere, under test
 * (lib/recipeBox.ts for a page, lib/reelView.ts for a card).
 *
 * Presentational only: it never handles a touch. A page lives inside the
 * book's gestures and a card inside its own Pressable.
 */

import React, { type ReactNode } from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import type { MealType } from '@workspace/recipe-model';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { fonts } from '@/constants/colors';
import { useColors } from '@/hooks/useColors';

// The same in both themes, 6:1 or better on either paper. The two greys are
// theme tokens (`paperMuted`, `paperFaint`): on the darker paper they had
// to darken to keep 4.5:1 (Oct 1).
export const INK = '#2a2118';
export const INK_SOFT = '#5c4d3c';
export const RULE = '#dccfb4';

export const FACE_PAD_TOP = 12;
export const FACE_PAD_X = 11;

export interface PageFaceProps {
  photo: ImageSourcePropType | null;
  mealType: MealType | null;
  photoHeight: number;
  /** Drawn over the picture's top-right corner (the book's rating). */
  badge?: ReactNode;
  /** Drawn over the whole picture (the reel's "opening" spinner). */
  photoOverlay?: ReactNode;
  title: string;
  time: string | null;
  servings: number | null;
  steps: number;
  /** false drops the serves-and-steps line (a card too short for it). */
  showServes?: boolean;
  ingredients: { names: string[]; more: number };
  /** 0 drops the ingredients line. */
  ingredientLines: number;
  /** Bottom-aligned by the caller's own `marginTop: 'auto'`. */
  footer: ReactNode;
  /** Absolutely placed, after everything (the book's page number). */
  corner?: ReactNode;
  paddingBottom: number;
  /** Caps Dynamic Type on a face whose height is fixed by its caller. */
  maxFontSizeMultiplier?: number;
  testID?: string;
}

export function PageFace({
  photo,
  mealType,
  photoHeight,
  badge,
  photoOverlay,
  title,
  time,
  servings,
  steps,
  showServes = true,
  ingredients,
  ingredientLines,
  footer,
  corner,
  paddingBottom,
  maxFontSizeMultiplier,
  testID,
}: PageFaceProps) {
  const colors = useColors();
  const muted = { color: colors.paperMuted };
  const serves = servings ? `Serves ${servings} · ` : '';
  const scale = maxFontSizeMultiplier === undefined ? {} : { maxFontSizeMultiplier };
  return (
    <View style={[faceStyles.content, { paddingBottom }]} testID={testID}>
      <View style={[faceStyles.photo, { height: photoHeight }]}>
        {photo ? (
          <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <MealTypeArt type={mealType} size={Math.round(photoHeight * 0.4)} tone="light" />
        )}
        {badge}
        {photoOverlay}
      </View>
      <Text style={faceStyles.title} numberOfLines={2} {...scale}>
        {title}
      </Text>
      {time ? (
        <Text style={[faceStyles.time, muted]} numberOfLines={1} testID="book-page-time" {...scale}>
          {time}
        </Text>
      ) : null}
      {showServes ? (
        <Text style={[faceStyles.serves, muted]} numberOfLines={1} {...scale}>
          {serves}
          {steps} {steps === 1 ? 'step' : 'steps'}
        </Text>
      ) : null}
      {ingredientLines > 0 && ingredients.names.length ? (
        <Text style={faceStyles.ingredients} numberOfLines={ingredientLines} {...scale}>
          {ingredients.names.join(', ')}
          {ingredients.more > 0 ? <Text style={{ color: colors.paperFaint }}> +{ingredients.more} more</Text> : null}
        </Text>
      ) : null}
      {footer}
      {corner}
    </View>
  );
}

export const faceStyles = StyleSheet.create({
  content: { flex: 1, paddingTop: FACE_PAD_TOP, paddingHorizontal: FACE_PAD_X },
  photo: { borderRadius: 6, overflow: 'hidden' },
  title: { marginTop: 8, fontFamily: fonts.heading, fontSize: 14.5, lineHeight: 18, color: INK },
  time: { marginTop: 5, fontFamily: fonts.mono, fontSize: 11, lineHeight: 14 },
  serves: {
    marginTop: 7,
    paddingTop: 6,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: RULE,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 14,
  },
  ingredients: { marginTop: 3, fontSize: 11.5, lineHeight: 15.5, color: INK_SOFT },
  // The footer pill: the book's "Cooked 3× · Sep 11", the reel's use.
  pill: { marginTop: 'auto', alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 99, paddingVertical: 3, paddingHorizontal: 8 },
  pillText: { fontSize: 10.5, lineHeight: 13, fontWeight: '600' },
});
