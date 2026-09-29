/**
 * components/recipe/TitleButton.tsx — the saved recipe's title, in the
 * navigation bar, as the way to rename it (Sep 29). Someone who wants to fix
 * a title taps the title; before this it did nothing, and Rename lived only
 * behind ⋮ and three taps into the editor. It opens the SAME window ⋮ ›
 * Rename opens (TitleWindow): one window, one rule, one write.
 *
 * One line, truncated BEFORE the pencil so the pencil never wraps away; at
 * least 44pt tall and 120pt wide however short the title, and never wider
 * than the bar leaves it, centred on iOS or leading elsewhere
 * (lib/headerTitle.ts); and to VoiceOver a button called "Rename recipe"
 * whose value is the title.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { TITLE_MIN_PT, titleButtonMaxWidth } from '@/lib/headerTitle';

export function TitleButton({ title, onPress }: { title: string; onPress: () => void }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Rename recipe"
      accessibilityValue={{ text: title }}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { maxWidth: titleButtonMaxWidth(width, Platform.OS === 'ios') }, pressed && { opacity: 0.6 }]}
      testID="recipe-title-button"
    >
      <Text style={[styles.text, { color: colors.foreground }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      <Feather name="edit-2" size={14} color={colors.mutedForeground} style={styles.pencil} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: TITLE_MIN_PT,
    paddingHorizontal: 8,
  },
  text: { flexShrink: 1, fontFamily: fonts.heading, fontSize: 17 },
  pencil: { marginLeft: 6, flexShrink: 0 },
});
