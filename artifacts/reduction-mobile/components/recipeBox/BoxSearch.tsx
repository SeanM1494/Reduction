/**
 * components/recipeBox/BoxSearch.tsx — search inside the Recipe Box: the
 * field at the top of the box, and the list that replaces the shelf while
 * there is something in it.
 *
 * Local only: `searchBox` (lib/recipeBox.ts, tested) — the Find tab's own
 * library filter over title, source and ingredient names, plus the book's
 * name — so "what can I make with parmesan" is a keystroke, not a request.
 * Removed recipes never match. Nothing found hands the query to the Find
 * tab's WEB search, prefilled and run.
 */

import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import { RATING_EMOJI, pageA11yLabel, resultMeta, type BoxHit } from '@/lib/recipeBox';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export function BoxSearchField({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.field}>
      <Feather name="search" size={17} color={colors.mutedForeground} style={styles.fieldIcon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Search your recipes or ingredients"
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search your recipes"
        testID="box-search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange('')}
          style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          testID="box-search-clear"
        >
          <Feather name="x" size={17} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function BoxResults({
  query,
  hits,
  onPick,
  onSearchWeb,
}: {
  query: string;
  hits: Array<BoxHit<Entry>>;
  onPick: (hit: BoxHit<Entry>) => void;
  onSearchWeb: (q: string) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  if (!hits.length) return <BoxNoMatches query={query} onSearchWeb={onSearchWeb} />;
  return (
    <FlatList
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      data={hits}
      keyExtractor={(h) => h.entry.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Text style={styles.count} testID="box-results-count">
          {hits.length} in your recipe box
        </Text>
      }
      renderItem={({ item }) => <ResultRow hit={item} onPick={onPick} />}
      testID="box-results"
    />
  );
}

/** Nothing in the box matched: say so, and offer the web. The grid's
 *  search ends here too. */
export function BoxNoMatches({ query, onSearchWeb }: { query: string; onSearchWeb: (q: string) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.empty} testID="box-no-results">
      <Text style={styles.emptyText}>Nothing in your recipe box matches “{query.trim()}”.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onSearchWeb(query.trim())}
        style={({ pressed }) => [styles.webBtn, pressed && styles.webBtnPressed]}
        testID="box-search-web"
      >
        <Text style={styles.webBtnText}>Search the web for it</Text>
      </Pressable>
    </View>
  );
}

/** One result. A list recycles its rows, so nothing about the recipe is
 *  remembered here — the photo hook keys on (id, version) itself
 *  (CLAUDE.md, "A LIST RECYCLES ITS CELLS"). */
function ResultRow({ hit, onPick }: { hit: BoxHit<Entry>; onPick: (hit: BoxHit<Entry>) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entry, book } = hit;
  const photo = useRecipePhoto(entry);
  const primary = sanitizeMealTypes(entry.recipe.mealTypes)[0] ?? null;
  const rating = entry.rating === 1 || entry.rating === 0 || entry.rating === -1 ? RATING_EMOJI[String(entry.rating)] : null;
  const meta = resultMeta(entry.recipe, entry.cooked);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pageA11yLabel(entry.recipe.title, book.name, entry.recipe, entry.rating)}
      accessibilityHint="Opens its book to this page"
      onPress={() => onPick(hit)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`box-result-${entry.id}`}
    >
      <View style={styles.thumb}>
        {photo ? (
          <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <MealTypeArt type={primary} size={22} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {entry.recipe.title}
          {rating ? ` ${rating}` : ''}
        </Text>
        <View style={styles.rowMeta}>
          <View style={[styles.chip, { backgroundColor: book.color }]}>
            <Text style={styles.chipText}>{book.name}</Text>
          </View>
          {meta ? (
            <Text style={styles.metaText} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 8,
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    fieldIcon: { marginLeft: 12 },
    // 16px or iOS zooms the page toward the field (CLAUDE.md).
    input: { flex: 1, minHeight: 44, fontSize: 16, color: colors.foreground, paddingHorizontal: 10, paddingVertical: 8 },
    clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
    clearPressed: { backgroundColor: colors.muted },
    list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },
    count: { fontSize: 12, color: colors.mutedForeground, marginBottom: 8, marginLeft: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 68,
      padding: 10,
      marginBottom: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    rowPressed: { borderColor: colors.borderStrong },
    thumb: { width: 48, height: 48, borderRadius: 9, overflow: 'hidden' },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
    chip: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
    chipText: { color: '#fff', fontSize: 10, letterSpacing: 0.6, fontWeight: '600', textTransform: 'uppercase' },
    metaText: { flexShrink: 1, fontSize: 12, color: colors.mutedForeground },
    empty: { paddingHorizontal: 24, paddingTop: 36, alignItems: 'center' },
    emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.mutedForeground },
    webBtn: {
      marginTop: 14,
      minHeight: 44,
      paddingHorizontal: 18,
      borderRadius: 99,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    webBtnPressed: { backgroundColor: colors.muted },
    webBtnText: { fontSize: 15, color: colors.foreground },
  });
}
