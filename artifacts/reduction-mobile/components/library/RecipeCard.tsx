/**
 * components/library/RecipeCard.tsx — one saved recipe in the library list.
 *
 * The web's `.rd-card`, token for token: meal-type badge (or "Untagged"), a
 * ★ for a favourite, the total time on the right; the title; "N steps ·
 * source" in mono; and the progress bar with its label. A 👎 is NOT shown
 * back — the rating still sorts and filters, it just does not decorate.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { countAll, countSteps, formatMinutes } from '@/shared/amounts';
import { MEAL_TYPE_LABELS, sanitizeMealTypes } from '@/shared/mealTypes';
import { progressOf, ratingOf, totalMinutes } from '@/lib/libraryView';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export function RecipeCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { pct, label } = progressOf(entry.done.length, countAll(entry.recipe));
  const types = sanitizeMealTypes(entry.recipe.mealTypes);
  const primary = types[0] ?? null;
  const mins = totalMinutes(entry);
  const steps = countSteps(entry.recipe);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.recipe.title}
      onPress={onPress}
      testID="library-card"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.top}>
        {primary ? (
          <View style={styles.type}>
            <Text style={styles.typeText}>{MEAL_TYPE_LABELS[primary].toUpperCase()}</Text>
          </View>
        ) : (
          <View style={[styles.type, styles.typeUntagged]}>
            <Text style={[styles.typeText, styles.typeTextUntagged]}>UNTAGGED</Text>
          </View>
        )}
        {types.length > 1 ? <Text style={styles.typeMore}>+{types.length - 1}</Text> : null}
        {ratingOf(entry) === 1 ? (
          <Text style={styles.fav} accessibilityLabel="Favourite">
            ★
          </Text>
        ) : null}
        {mins !== null ? <Text style={styles.time}>{formatMinutes(mins)}</Text> : null}
      </View>
      <Text style={styles.title} numberOfLines={3}>
        {entry.recipe.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {steps} {steps === 1 ? 'step' : 'steps'}
        {entry.recipe.source ? ` · ${entry.recipe.source}` : ''}
      </Text>
      <View style={styles.bar}>
        <LinearGradient
          colors={[colors.warmLine, colors.coolInk]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${pct}%` }]}
        />
      </View>
      <Text style={styles.pct}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 15,
      paddingHorizontal: 16,
      paddingBottom: 14,
      gap: 7,
      ...cardShadow,
    },
    cardPressed: { borderColor: colors.borderStrong },
    top: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: -1 },
    type: {
      borderRadius: 99,
      paddingVertical: 3,
      paddingHorizontal: 9,
      backgroundColor: colors.warmBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
    },
    typeUntagged: { backgroundColor: colors.muted, borderColor: colors.border },
    typeText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.5, color: colors.warmInk },
    typeTextUntagged: { color: colors.mutedForeground },
    typeMore: { fontSize: 11, color: colors.faint },
    fav: { color: colors.warmLine, fontSize: 13, lineHeight: 15 },
    time: { marginLeft: 'auto', fontFamily: fonts.mono, fontSize: 10.5, color: colors.mutedForeground },
    title: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 19, letterSpacing: -0.24, color: colors.foreground },
    meta: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15, color: colors.faint },
    bar: { height: 4, borderRadius: 99, backgroundColor: colors.border, overflow: 'hidden', marginTop: 3 },
    fill: { height: '100%', borderRadius: 99 },
    pct: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.4, color: colors.mutedForeground },
  });
}
