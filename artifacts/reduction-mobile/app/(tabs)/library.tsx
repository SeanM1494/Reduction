/**
 * app/(tabs)/library.tsx — the library as a destination.
 *
 * The web's MyRecipes.tsx, ported: filter by meal type (chips, one scrolling
 * row), sort by what matters when deciding what to cook (a sheet, where the
 * web has a <select>), and a card per recipe. All client-side over the loaded
 * library — at this scale a search index would be plumbing without a payoff.
 * The filter and sort logic is in lib/libraryView.ts, under test.
 *
 * The tab header already says "Library", so the list carries no title of
 * its own: one row holds the sort control and the count.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '@/lib/library-context';
import { MEAL_TYPE_LABELS } from '@/shared/mealTypes';
import {
  arrangeLibrary,
  hasFavourites,
  hasUntagged,
  presentMealTypes,
  sortLabel,
  type Filter,
  type SortKey,
} from '@/lib/libraryView';
import { RecipeCard } from '@/components/library/RecipeCard';
import { SortSheet } from '@/components/library/SortSheet';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function LibraryScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entries, loading, error, refresh } = useLibrary();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('added');
  const [sortOpen, setSortOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // The tab bar is absolutely positioned (see (tabs)/_layout.tsx), so the
  // list pads itself past it: the classic bar is 49px plus the home
  // indicator; on web the layout pins it at 84. Over-padding is harmless.
  const tabBarHeight = 84 + insets.bottom;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const chips = useMemo(() => {
    const out: Array<{ value: Filter; label: string }> = [{ value: 'all', label: 'All' }];
    if (hasFavourites(entries)) out.push({ value: 'favourites', label: '★ Favourites' });
    for (const t of presentMealTypes(entries)) out.push({ value: t, label: MEAL_TYPE_LABELS[t] });
    if (hasUntagged(entries)) out.push({ value: 'untagged', label: 'Untagged' });
    return out;
  }, [entries]);

  // A filter whose chip has gone (the last favourite un-starred) falls back
  // to everything rather than to an empty list with no chip lit.
  const effectiveFilter = chips.some((c) => c.value === filter) ? filter : 'all';
  const shown = useMemo(() => arrangeLibrary(entries, effectiveFilter, sort), [entries, effectiveFilter, sort]);

  if (loading && entries.length === 0 && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.foreground} />}
      >
        {error ? <ErrorBox message={error} onRetry={refresh} colors={colors} /> : null}
        <View style={styles.empty} testID="library-empty">
          <Text style={styles.emptyText}>
            Nothing saved yet. Anything you diagram lands here, with your progress kept.
          </Text>
          <SheetButton label="Find a recipe" onPress={() => router.navigate('/')} testID="library-find" />
        </View>
      </ScrollView>
    );
  }

  const countLabel =
    shown.length === entries.length
      ? `${entries.length} ${entries.length === 1 ? 'recipe' : 'recipes'}`
      : `${shown.length} of ${entries.length}`;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
        data={shown}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.foreground} />}
        ListHeaderComponent={
          <View style={styles.head}>
            {error ? <ErrorBox message={error} onRetry={refresh} colors={colors} /> : null}
            <View style={styles.sortRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sort: ${sortLabel(sort)}`}
                onPress={() => setSortOpen(true)}
                style={({ pressed }) => [styles.sortBtn, pressed && styles.sortBtnPressed]}
                testID="library-sort"
              >
                <Text style={styles.sortLabel}>Sort</Text>
                <Text style={styles.sortValue}>{sortLabel(sort)}</Text>
                <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
              </Pressable>
              <Text style={styles.count} testID="library-count">
                {countLabel}
              </Text>
            </View>
            {/* One row, horizontally scrollable rather than wrapped — a
                wrapped chip row two deep pushes the recipes below the fold. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
            >
              {chips.map((c) => {
                const on = c.value === effectiveFilter;
                return (
                  <Pressable
                    key={c.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setFilter(c.value)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nothing matches that filter.</Text>
          </View>
        }
        renderItem={({ item }) => <RecipeCard entry={item} onPress={() => router.push(`/recipe/${item.id}`)} />}
      />
      <SortSheet open={sortOpen} value={sort} onPick={setSort} onClose={() => setSortOpen(false)} />
    </View>
  );
}

function ErrorBox({ message, onRetry, colors }: { message: string; onRetry: () => void; colors: Colors }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <SheetButton label="Try again" onPress={onRetry} />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
    head: { gap: 6, marginBottom: 4 },
    sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    sortBtnPressed: { borderColor: colors.borderStrong },
    sortLabel: { fontSize: 12.5, fontWeight: '600', color: colors.mutedForeground },
    sortValue: { fontSize: 15, color: colors.foreground },
    count: { fontFamily: fonts.mono, fontSize: 11, color: colors.faint },
    chipRow: { marginHorizontal: -16 },
    chipRowContent: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8, gap: 8 },
    chip: {
      minHeight: 44,
      paddingHorizontal: 15,
      paddingVertical: 8,
      justifyContent: 'center',
      borderRadius: 99,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13.5, color: colors.mutedForeground },
    chipTextOn: { color: colors.primaryForeground, fontWeight: '600' },
    empty: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingVertical: 26,
      paddingHorizontal: 20,
      alignItems: 'center',
      gap: 14,
    },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.mutedForeground, textAlign: 'center' },
    error: {
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      borderRadius: 9,
      padding: 12,
      gap: 10,
      marginBottom: 6,
    },
    errorText: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
  });
}
