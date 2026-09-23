/**
 * components/library/MealTypeArt.tsx — the no-photo card face: a Feather
 * glyph on the meal type's tint (lib/mealTypeArt.ts). Fills whatever box it
 * is put in; the glyph scales with `size`.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { mealTypeArt } from '@/lib/mealTypeArt';
import { useColors } from '@/hooks/useColors';
import type { MealType } from '@/shared/mealTypes';

export function MealTypeArt({
  type,
  size = 36,
  tone: fixed,
}: {
  type: MealType | null;
  size?: number;
  /** Force a tone instead of following the theme — the Recipe Box's pages
   *  stay cream in dark mode, and a dark tile on cream paper reads badly. */
  tone?: 'light' | 'dark';
}) {
  const colors = useColors();
  const art = mealTypeArt(type);
  const tone = (fixed ?? colors.scheme) === 'dark' ? art.dark : art.light;
  return (
    <View style={[styles.box, { backgroundColor: tone.bg }]} testID="card-art" accessibilityElementsHidden>
      <Feather name={art.icon as never} size={size} color={tone.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
