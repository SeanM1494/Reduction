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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
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
import type { Entry } from '@/lib/api';
import { RecipeBox } from '@/components/recipeBox/RecipeBox';
import { PreviewSheet } from '@/components/recipeBox/PreviewSheet';
import { VIEW_KEY, parseLibraryView, type LibraryView } from '@/lib/libraryViewMode';
import { SortSheet } from '@/components/library/SortSheet';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function LibraryScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entries, loading, error, refresh, notice, clearNotice } = useLibrary();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('added');
  const [sortOpen, setSortOpen] = useState(false);
  // Grid or Stack, remembered per device (lib/libraryViewMode.ts). Read
  // once; until it is read the grid shows, which is the default anyway.
  const [view, setView] = useState<LibraryView>('grid');
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((raw) => setView(parseLibraryView(raw)))
      .catch(() => {});
  }, []);
  const pickView = (next: LibraryView) => {
    setView(next);
    AsyncStorage.setItem(VIEW_KEY, next).catch(() => {});
  };
  // The books carry their own header ("Recipe box · Dinner"), and the
  // carousel needs the height for the books above and below to show, so the
  // navigator's "Library" title goes while they are up. It also makes the
  // two tab layouts the same screen: NativeTabs never had a header here.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: view !== 'books' });
  }, [navigation, view]);
  const insets = useSafeAreaInsets();
  // The tab bar is absolutely positioned (see (tabs)/_layout.tsx), so the
  // list pads itself past it: the classic bar is 49px plus the home
  // indicator; on web the layout pins it at 84. Over-padding is harmless.
  const tabBarHeight = 84 + insets.bottom;
  // The TOP inset has to be paid by this screen, because the category strip
  // is a plain View and the FIRST thing on it. A ScrollView gets iOS's
  // automatic content-inset adjustment and the old chips-inside-the-list
  // layout rode on that; a View gets nothing and lands under the notch.
  // `useSafeAreaInsets` reports 0 here whenever a navigator header is
  // already absorbing it (ClassicTabLayout, and the web), and the real
  // inset when nothing is (NativeTabs on iOS 26 shows NO header — see
  // (tabs)/_layout.tsx, and it is the path a real iPhone takes while
  // Chromium takes the other one, which is why this was invisible here).

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
  // An odd last card would otherwise fill its whole row: the card is
  // `flex: 1` and a row of one has no sibling to halve it. A hole keeps
  // the grid a grid.
  const grid = useMemo<Array<Entry | null>>(() => (shown.length % 2 ? [...shown, null] : shown), [shown]);

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

  // The sort row, and anything the sync had to say: the grid's header. (The
  // Recipe Box has its own header, with the sort in it.)
  const head = (
    <View style={styles.head}>
      {error ? <ErrorBox message={error} onRetry={refresh} colors={colors} /> : null}
      {notice?.kind === 'failure' ? <NoticeBox message={notice.message} onDismiss={clearNotice} colors={colors} /> : null}
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
    </View>
  );

  const emptyFilter = (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>Nothing matches that filter.</Text>
    </View>
  );

  // The Recipe Box: its own layout, not the grid's. No category strip — the
  // books ARE the categories — and it is a sibling of nothing scrollable,
  // because the page turn is a pan (CLAUDE.md).
  if (view === 'books') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {error ? (
          <View style={styles.boxError}>
            <ErrorBox message={error} onRetry={refresh} colors={colors} />
          </View>
        ) : null}
        <RecipeBox
          entries={entries}
          sort={sort}
          onOpenSort={() => setSortOpen(true)}
          onOpenRecipe={(e) => setPreviewId(e.id)}
          onAddRecipe={() => router.navigate('/')}
          onShowGrid={() => pickView('grid')}
          onSearchWeb={(q) => router.navigate({ pathname: '/', params: { q } })}
          bottomInset={tabBarHeight}
        />
        <SortSheet open={sortOpen} value={sort} onPick={setSort} onClose={() => setSortOpen(false)} />
        {/* A page opens a preview, not the recipe: a look before committing,
            and the choice of the diagram or straight into cooking. The
            entry is looked up fresh, so a sync landing underneath shows. */}
        <PreviewSheet
          entry={previewId ? entries.find((e) => e.id === previewId) ?? null : null}
          onClose={() => setPreviewId(null)}
          onOpen={(e, v) => {
            setPreviewId(null);
            router.push(`/recipe/${e.id}?view=${v}`);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* The category strip, pinned above the list rather than scrolling
          with it: the point of the recipe box is jumping to a category,
          and a tab that has scrolled away cannot be jumped to. */}
      <View style={styles.stripRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
        testID="library-tabs"
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
              testID={`library-tab-${c.value}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Grid or Books: one 44px button at the strip's end, so the sort row
          stays two things wide (it is full at 320px already). Temporary:
          Settings' "Recipe box style" replaces it (ROADMAP, step 7). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show as books"
        onPress={() => pickView('books')}
        style={({ pressed }) => [styles.viewBtn, pressed && { opacity: 0.6 }]}
        testID="library-view-toggle"
        // For the check: which view is on.
        aria-label={view}
      >
        <Feather name="book-open" size={20} color={colors.foreground} />
      </Pressable>
      </View>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
        data={grid}
        keyExtractor={(e, i) => e?.id ?? `hole-${i}`}
        // Two columns: a recipe box is browsed by picture, and one card per
        // row was a list with extra steps. `key` forces a remount if the
        // column count ever changes, which FlatList requires.
        numColumns={2}
        key="grid-2"
        columnWrapperStyle={styles.row}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.foreground} />}
        ListHeaderComponent={head}
        ListEmptyComponent={emptyFilter}
        renderItem={({ item }) =>
          item ? (
            <RecipeCard entry={item} layout="grid" onPress={() => router.push(`/recipe/${item.id}`)} />
          ) : (
            <View style={styles.hole} />
          )
        }
      />
      <SortSheet open={sortOpen} value={sort} onPick={setSort} onClose={() => setSortOpen(false)} />
    </View>
  );
}

function NoticeBox({ message, onDismiss, colors }: { message: string; onDismiss: () => void; colors: Colors }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.error} accessibilityRole="alert" testID="library-notice">
      <Text style={styles.errorText}>{message}</Text>
      <SheetButton label="Dismiss" onPress={onDismiss} />
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
    row: { gap: 10 },
    hole: { flex: 1 },
    boxError: { paddingHorizontal: 16, paddingTop: 8 },
    stripRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: colors.border },
    viewBtn: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: 8, alignSelf: 'center' },
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
    chipRow: { flexGrow: 1, flexShrink: 1 },
    chipRowContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 8 },
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
