/**
 * components/settings/BoxStyleCard.tsx — "Recipe box style": the Library as
 * books (the default) or as a flat grid. Per device, like Appearance, and
 * a radiogroup in the same shape.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetOption, optionRow } from '@/components/Sheet';
import { BOX_STYLES } from '@/lib/libraryViewMode';
import { setBoxStyle, useBoxStyle } from '@/lib/boxStyle';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export function BoxStyleCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const style = useBoxStyle();
  return (
    <View style={styles.section} testID="box-style-card">
      <Text style={styles.label}>Recipe box style</Text>
      <View style={[optionRow, styles.row]} accessibilityRole="radiogroup" accessibilityLabel="Recipe box style">
        {BOX_STYLES.map(({ view, label }) => (
          <SheetOption key={view} label={label} current={style === view} onPress={() => setBoxStyle(view)} role="radio" testID={`box-style-${view}`} />
        ))}
      </View>
      <Text style={styles.hint}>
        {style === 'books' ? 'A book for each meal, two recipes to a spread.' : 'Every recipe on one page, two across.'}
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
