/**
 * components/library/RecipeCard.tsx — one saved recipe, as a card in the
 * recipe box: its picture (or the meal-type art), its name, a ★ when it is
 * a favourite. The grid's card, two across (the Recipe Box's books draw
 * their own pages, components/recipeBox/BookPage.tsx).
 *
 * What is NOT here any more: the progress bar and the step count. A card in
 * a box is for finding a recipe, not reading its state; both are on the
 * recipe screen. A 👎 is still not shown back — the rating sorts and
 * filters, it does not decorate.
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '@/shared/amounts';
import { MEAL_TYPE_LABELS, sanitizeMealTypes } from '@/shared/mealTypes';
import { ratingOf, totalMinutes } from '@/lib/libraryView';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export function RecipeCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const types = sanitizeMealTypes(entry.recipe.mealTypes);
  const primary = types[0] ?? null;
  const mins = totalMinutes(entry);
  const photo = useRecipePhoto(entry);
  const fav = ratingOf(entry) === 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.recipe.title}${fav ? ', favourite' : ''}${primary ? `, ${MEAL_TYPE_LABELS[primary]}` : ''}`}
      onPress={onPress}
      testID="library-card"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.face}>
        {photo ? (
          <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors testID="card-photo" />
        ) : (
          <MealTypeArt type={primary} size={36} />
        )}
        {fav ? (
          <View style={styles.favBadge} accessibilityLabel="Favourite" testID="card-fav">
            <Text style={styles.favText}>★</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.recipe.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {primary ? MEAL_TYPE_LABELS[primary] : 'Untagged'}
          {types.length > 1 ? ` +${types.length - 1}` : ''}
          {mins !== null ? ` · ${formatMinutes(mins)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      ...cardShadow,
    },
    cardPressed: { borderColor: colors.borderStrong },
    // 4:3, the shape of a plated dish photographed from above a table.
    face: { aspectRatio: 4 / 3, backgroundColor: colors.muted, overflow: 'hidden' },
    favBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      ...cardShadow,
    },
    favText: { color: colors.warmLine, fontSize: 14, lineHeight: 16 },
    body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 3 },
    title: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 18, letterSpacing: -0.2, color: colors.foreground },
    meta: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15, color: colors.faint },
  });
}
