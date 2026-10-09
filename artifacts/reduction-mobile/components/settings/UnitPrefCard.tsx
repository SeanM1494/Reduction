/**
 * components/settings/UnitPrefCard.tsx — "Measurements": grams, ounces, or
 * the recipe as written. Only matters for recipes whose source listed both.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetOption, optionRow } from '@/components/Sheet';
import { UNIT_PREFS } from '@/lib/unitPrefPolicy';
import { setUnitPref, useUnitSetting } from '@/lib/unitPref';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

/** `bare`: inside a Settings pop-up, which supplies the card and the title. */
export function UnitPrefCard({ bare = false }: { bare?: boolean } = {}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const pref = useUnitSetting();
  return (
    <View style={bare ? undefined : styles.section} testID="unit-pref-card">
      {bare ? null : <Text style={styles.label}>Measurements</Text>}
      <View style={[optionRow, styles.row]} accessibilityRole="radiogroup" accessibilityLabel="Measurements">
        {UNIT_PREFS.map(({ pref: p, label }) => (
          <SheetOption key={p} label={label} current={pref === p} onPress={() => setUnitPref(p)} role="radio" testID={`unit-pref-${p}`} />
        ))}
      </View>
      <Text style={styles.hint}>
        Used when a recipe lists both. A recipe with one unit shows it as written.
      </Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    section: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      paddingHorizontal: 18,
      gap: 4,
      ...cardShadow,
    },
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    row: { marginTop: 8 },
    hint: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground, marginTop: 6 },
  });
}
