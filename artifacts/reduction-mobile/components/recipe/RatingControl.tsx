/**
 * components/recipe/RatingControl.tsx — five whole stars, and hidden until
 * the recipe has been cooked once. Whole stars on purpose (ten half-star
 * targets across a phone are under 44px each), and the rules that survive
 * from the three-way control it replaced: one rating per recipe (a standing
 * verdict, allowed to change), tapping the current rating clears it, and
 * 44px targets because this sits under a thumb mid-kitchen.
 *
 * Used twice: the recipe's Rating sheet (tap the same star to clear) and the
 * finish prompt (`clearOnRepeat={false}`: a tap there is an answer, never an
 * undo). The word under the stars names the one chosen, so a rating is never
 * just a count.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { STAR_WORDS, STARS_MAX } from '@/shared/stars';
import { useColors, type Colors } from '@/hooks/useColors';

const VALUES = Array.from({ length: STARS_MAX }, (_, i) => i + 1);

export function RatingControl({
  stars,
  onChange,
  clearOnRepeat = true,
}: {
  stars: number | null | undefined;
  onChange: (stars: number | null) => void;
  clearOnRepeat?: boolean;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const current = typeof stars === 'number' ? stars : null;
  return (
    <View style={styles.wrap}>
      {/* A toolbar of toggle buttons, not a radiogroup: tapping the current
          one clears it, which a radio cannot do, and a reader told "radio
          button" would expect one to stay chosen. */}
      <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Rate this recipe" testID="rating">
        {VALUES.map((value) => {
          const filled = current !== null && value <= current;
          const on = current === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="togglebutton"
              aria-checked={on}
              accessibilityLabel={`${value} ${value === 1 ? 'star' : 'stars'}, ${STAR_WORDS[value]}`}
              accessibilityHint={on && clearOnRepeat ? 'Clears your rating' : 'Rates this recipe'}
              testID={`rating-${value}`}
              onPress={() => onChange(on && clearOnRepeat ? null : value)}
              style={styles.btn}
              hitSlop={2}
            >
              <Text style={[styles.star, filled ? styles.starOn : styles.starOff]}>★</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.word} testID="rating-word" accessibilityElementsHidden importantForAccessibility="no">
        {current !== null ? STAR_WORDS[current] : ' '}
      </Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', gap: 2 },
    row: { flexDirection: 'row', gap: 4 },
    btn: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    star: { fontSize: 34, lineHeight: 40 },
    starOn: { color: colors.warmLine },
    // Unselected sit back so the chosen count reads at a glance.
    starOff: { color: colors.border },
    word: { minHeight: 20, fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.foreground },
  });
}
