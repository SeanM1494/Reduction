/**
 * components/recipe/RatingControl.tsx — three states, not five, and hidden
 * until the recipe has been cooked once. The web component's header carries
 * the reasoning; the rules that survive the port: one rating per recipe (a
 * standing verdict, allowed to change), tapping the current rating clears
 * it, and 44px targets because this sits under a thumb mid-kitchen.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';

export const RATING_DOWN = -1;
export const RATING_OK = 0;
export const RATING_UP = 1;

const OPTIONS: Array<{ value: number; glyph: string; label: string }> = [
  { value: RATING_DOWN, glyph: '\u{1F44E}', label: 'Would not make again' },
  { value: RATING_OK, glyph: '\u{1F44C}', label: 'Fine' },
  { value: RATING_UP, glyph: '\u{1F44D}', label: 'Favourite' },
];

export function RatingControl({
  rating,
  onChange,
}: {
  rating: number | null | undefined;
  onChange: (rating: number | null) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const current = typeof rating === 'number' ? rating : null;
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Rate this recipe" testID="rating">
      {OPTIONS.map(({ value, glyph, label }) => {
        const on = current === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={on ? `${label} — tap to clear` : label}
            onPress={() => onChange(on ? null : value)}
            style={[styles.btn, on && styles.btnOn]}
          >
            <Text style={[styles.glyph, !on && styles.glyphOff]}>{glyph}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: 6 },
    btn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    btnOn: { borderColor: colors.borderStrong, backgroundColor: colors.muted },
    glyph: { fontSize: 18, lineHeight: 22 },
    // Unselected sit back so the chosen one reads at a glance; full colour on
    // every option would make three equal shouts.
    glyphOff: { opacity: 0.55 },
  });
}
