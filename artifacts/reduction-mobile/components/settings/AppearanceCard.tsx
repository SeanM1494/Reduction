/**
 * components/settings/AppearanceCard.tsx — light, dark, colorblind, or the
 * phone's choice.
 *
 * The web's ThemeToggle as a Settings card, with System as a fourth,
 * visible option (lib/themePolicy.ts says why). A radiogroup: exactly one
 * is chosen, and the choice is stored (lib/theme-context.tsx).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetOption, optionRow } from '@/components/Sheet';
import { useThemeState } from '@/lib/theme-context';
import { THEME_MODES } from '@/lib/themePolicy';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export function AppearanceCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const theme = useThemeState();
  if (!theme) return null;
  return (
    <View style={styles.section} testID="appearance-card">
      <Text style={styles.label}>Appearance</Text>
      <View style={[optionRow, styles.row]} accessibilityRole="radiogroup" accessibilityLabel="Color theme">
        {THEME_MODES.map(({ mode, label }) => (
          <SheetOption key={mode} label={label} current={theme.mode === mode} onPress={() => theme.setMode(mode)} role="radio" testID={`theme-${mode}`} />
        ))}
      </View>
      <Text style={styles.hint}>
        {theme.mode === 'colorblind'
          ? 'Blue and orange stand in for the green and red, and a ready step also carries a mark.'
          : theme.mode === 'system'
            ? 'Follows the phone.'
            : ''}
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
    hint: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground, marginTop: 6, minHeight: 18 },
  });
}
