/**
 * components/recipeBox/RecipeBox.tsx — the Library as a shelf of cookbooks:
 * a header naming the open book, the book, and the page controls under it.
 *
 * Step 2 of the build (ROADMAP "The Recipe Box: books"): one book at a time,
 * turned with the finger or the ‹ › buttons. The carousel between books,
 * search, the preview sheet and the rating prompt land in later steps and
 * slot in here. Which book a recipe is in, their order and every label come
 * from lib/recipeBox.ts, under test.
 *
 * Remembers which spread each book was open to, for the session — switching
 * books and back returns you to the page you left.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Book } from '@/components/recipeBox/Book';
import { clampSpread, pagesLabel, shelf, spreadCount, type BookId } from '@/lib/recipeBox';
import { sortLabel, type SortKey } from '@/lib/libraryView';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

interface Props {
  entries: Entry[];
  sort: SortKey;
  onOpenSort: () => void;
  onOpenRecipe: (entry: Entry) => void;
  onAddRecipe: () => void;
  /** Temporary, until Settings' "Recipe box style" (step 7) replaces it. */
  onShowGrid: () => void;
  bottomInset: number;
}

export function RecipeBox({ entries, sort, onOpenSort, onOpenRecipe, onAddRecipe, onShowGrid, bottomInset }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width: screenW } = useWindowDimensions();
  const books = useMemo(() => shelf(entries, sort), [entries, sort]);
  const [openBook, setOpenBook] = useState<BookId | null>(null);
  const [spreads, setSpreads] = useState<Partial<Record<BookId, number>>>({});

  // The first book with recipes, until the person picks another; and if the
  // one they had open empties, the first again.
  const current = books.find((b) => b.book.id === openBook) ?? books[0];
  const setSpread = useCallback(
    (k: number) => {
      if (!current) return;
      setSpreads((s) => ({ ...s, [current.book.id]: k }));
    },
    [current]
  );
  if (!current) return null;
  const { book, pages } = current;
  const k = clampSpread(spreads[book.id] ?? 0, pages.length);
  const last = spreadCount(pages.length) - 1;
  void setOpenBook; // the carousel (step 3) sets it

  return (
    <View style={[styles.root, { paddingBottom: bottomInset }]} testID="recipe-box">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>Recipe box</Text>
          <Text style={[styles.bookName, { color: book.color }]} numberOfLines={1} testID="box-book-name">
            {book.name}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.count} testID="box-book-count">
            Book {books.indexOf(current) + 1} of {books.length}
          </Text>
          <View style={styles.headerButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${sortLabel(sort)}`}
              onPress={onOpenSort}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              testID="box-sort"
            >
              <Feather name="sliders" size={18} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show as a grid"
              onPress={onShowGrid}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              testID="library-view-toggle"
              aria-label="books"
            >
              <Feather name="grid" size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.stage} testID="box-stage">
        <Book
          key={book.id}
          book={book}
          pages={pages}
          spread={k}
          onSpreadChange={setSpread}
          onOpenPage={onOpenRecipe}
          onBlankPage={onAddRecipe}
          screenWidth={screenW}
        />
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous pages"
          disabled={k === 0}
          onPress={() => setSpread(k - 1)}
          style={({ pressed }) => [styles.pageBtn, k === 0 && styles.pageBtnOff, pressed && styles.iconBtnPressed]}
          testID="box-prev"
        >
          <Feather name="chevron-left" size={22} color={colors.mutedForeground} />
        </Pressable>
        <Text style={styles.pages} testID="box-pages">
          {pagesLabel(k, pages.length)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next pages"
          disabled={k >= last}
          onPress={() => setSpread(k + 1)}
          style={({ pressed }) => [styles.pageBtn, k >= last && styles.pageBtnOff, pressed && styles.iconBtnPressed]}
          testID="box-next"
        >
          <Feather name="chevron-right" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8, gap: 12 },
    headerLeft: { flexShrink: 1 },
    kicker: { fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: colors.mutedForeground },
    bookName: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 26, marginTop: 2 },
    headerRight: { alignItems: 'flex-end', gap: 2 },
    count: { fontFamily: fonts.mono, fontSize: 12, color: colors.mutedForeground },
    headerButtons: { flexDirection: 'row', gap: 4 },
    iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    iconBtnPressed: { backgroundColor: colors.muted },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
    pageBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pageBtnOff: { opacity: 0.35 },
    pages: { fontFamily: fonts.mono, fontSize: 12, color: colors.mutedForeground },
  });
}
