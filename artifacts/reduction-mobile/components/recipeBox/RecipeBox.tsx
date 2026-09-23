/**
 * components/recipeBox/RecipeBox.tsx — the Library as a shelf of cookbooks:
 * a header naming the book in front, the books, and the page controls under
 * them.
 *
 * Pages turn sideways inside a book (Book.tsx); books change VERTICALLY, in
 * an endless carousel: the book in front, the one before it peeking from
 * above (its name on a tab under it) and the next peeking from below. Swipe
 * up for the next, down for the one before, or tap a peek. With two books
 * the other one only ever waits below, and a swipe down gives and springs
 * back; with one there is nothing to swipe to and nothing peeks (ROADMAP
 * "The Recipe Box: books").
 *
 * ONE CONTINUOUS POSITION (CLAUDE.md), in books: `pos` is an unbounded
 * number and every book is drawn from its offset to it (`loopOffset`), so a
 * swipe, a settle and a tap-to-go all move one value and nothing is ever
 * reset. `at` is where `pos` is headed, set when a change commits rather
 * than when it lands — which is what lets the header name the new book
 * while it is still rising, and a second swipe interrupt the first.
 *
 * The book's size and the spacing come from the stage's measured size
 * (`carouselGeometry`): the prototype's book where there is room for the
 * neighbours to show, a narrower one where there is not. That is a measured
 * layout, so the stage draws nothing until its first layout arrives — one
 * frame, once.
 *
 * Every number and rule is in lib/recipeBox.ts, under test.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { Book } from '@/components/recipeBox/Book';
import {
  CAROUSEL,
  FLIP,
  bookSettleMs,
  bookSwipeCommits,
  carouselDrag,
  carouselGeometry,
  carouselPlacement,
  carouselWindow,
  clampSpread,
  loopOffset,
  pagesLabel,
  shelf,
  shelfIndex,
  spreadCount,
  type Book as BookInfo,
  type BookId,
} from '@/lib/recipeBox';
import { sortLabel, type SortKey } from '@/lib/libraryView';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

const EASE = Easing.inOut(Easing.cubic);

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
  const reduceMotion = useReducedMotion();
  const books = useMemo(() => shelf(entries, sort), [entries, sort]);
  const m = books.length;
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [at, setAt] = useState(0);
  const [spreads, setSpreads] = useState<Partial<Record<BookId, number>>>({});

  const pos = useSharedValue(0);
  const start = useSharedValue(0);
  const t0 = useSharedValue(0);
  const countSV = useSharedValue(m);
  countSV.value = m;

  const index = shelfIndex(at, m);
  const current = books[index];

  // The shelf can change under the carousel — a first recipe opens a new
  // book, a last one removed closes it. Keep the same book in front: find it
  // again and move the position to it without animating (nothing the person
  // did moved it, so nothing should slide).
  const frontId = useRef<BookId | null>(null);
  useEffect(() => {
    if (!m) return;
    const id = frontId.current;
    const found = id ? books.findIndex((b) => b.book.id === id) : -1;
    if (found >= 0 && found !== shelfIndex(at, m)) {
      const next = at - shelfIndex(at, m) + found;
      setAt(next);
      pos.value = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books]);
  // After the one above, so that it reads the book that WAS in front.
  useEffect(() => {
    frontId.current = current?.book.id ?? null;
  });

  const tick = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  /** Go `d` books along (±1) — a tapped peek, VoiceOver's actions. */
  const goBook = useCallback(
    (d: number) => {
      if (m < 2 || (m === 2 && d < 0)) return;
      const to = Math.round(pos.value) + d;
      setAt(to);
      tick();
      pos.value = reduceMotion ? to : withTiming(to, { duration: CAROUSEL.settleMs, easing: EASE });
    },
    [m, pos, reduceMotion, tick]
  );

  const committed = useCallback(
    (to: number) => {
      setAt(to);
      tick();
    },
    [tick]
  );

  const setSpread = useCallback(
    (k: number) => {
      if (!current) return;
      setSpreads((s) => ({ ...s, [current.book.id]: k }));
    },
    [current]
  );

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setStage((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  };

  const geo = stage ? carouselGeometry(stage.w, stage.h, m) : null;
  const step = geo?.step ?? 1;

  // Vertical: books. The page turn inside the front book is a horizontal
  // pan that fails on vertical movement, and this one fails on horizontal,
  // so the first 8px decide which of the two a drag is.
  const pan = Gesture.Pan()
    .enabled(m >= 2)
    .activeOffsetY([-FLIP.axisLockPx, FLIP.axisLockPx])
    .failOffsetX([-FLIP.axisLockPx, FLIP.axisLockPx])
    .onBegin(() => {
      start.value = pos.value;
      t0.value = Date.now();
    })
    .onUpdate((e) => {
      pos.value = start.value + carouselDrag(e.translationY, step, countSV.value >= 3);
    })
    .onEnd((e) => {
      const base = Math.round(start.value);
      const d = e.translationY < 0 ? 1 : -1;
      const allowed = d > 0 || countSV.value >= 3;
      const commit = allowed && bookSwipeCommits(e.translationY, Date.now() - t0.value, step);
      const to = commit ? base + d : base;
      if (commit) runOnJS(committed)(to);
      const travelled = commit ? Math.abs(pos.value - base) : 0;
      pos.value = reduceMotion
        ? to
        : withTiming(to, {
            duration: commit ? bookSettleMs(travelled) : CAROUSEL.cancelMs,
            easing: EASE,
          });
    });

  if (!current) return null;
  const { book, pages } = current;
  const k = clampSpread(spreads[book.id] ?? 0, pages.length);
  const last = spreadCount(pages.length) - 1;
  const mounted = carouselWindow(at, m);

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
            Book {index + 1} of {m}
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

      <GestureDetector gesture={pan}>
        <View style={styles.stage} onLayout={onStageLayout} testID="box-stage">
          {geo && stage
            ? mounted.map((i) => {
                const entry = books[i];
                const front = i === index;
                return (
                  <ShelfSlot
                    key={entry.book.id}
                    index={i}
                    count={m}
                    pos={pos}
                    step={geo.step}
                    left={(stage.w - geo.bookW) / 2}
                    top={geo.top}
                    coverH={geo.coverH}
                    book={entry.book}
                    front={front}
                    onTapPeek={goBook}
                  >
                    <Book
                      book={entry.book}
                      pages={entry.pages}
                      spread={clampSpread(spreads[entry.book.id] ?? 0, entry.pages.length)}
                      onSpreadChange={setSpread}
                      onOpenPage={onOpenRecipe}
                      onBlankPage={onAddRecipe}
                      width={geo.bookW}
                      interactive={front}
                      onNextBook={m >= 2 ? () => goBook(1) : undefined}
                      onPrevBook={m >= 3 ? () => goBook(-1) : undefined}
                    />
                  </ShelfSlot>
                );
              })
            : null}
        </View>
      </GestureDetector>

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
        <View style={styles.mid}>
          <Text style={styles.pages} testID="box-pages">
            {pagesLabel(k, pages.length)}
          </Text>
          {/* Where you are on the shelf. A picture, not a control: seven
              7px dots cannot each be a 44px target in the room between the
              arrows, and a peek, a swipe and search all get you anywhere. */}
          {m >= 2 ? (
            <View style={styles.rail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="box-rail">
              {books.map((b, i) => (
                <View
                  key={b.book.id}
                  style={[styles.dot, i === index && { width: 20, opacity: 1, backgroundColor: b.book.color }]}
                />
              ))}
            </View>
          ) : null}
        </View>
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

/**
 * One book's place in the carousel: placed entirely by its offset from the
 * position, with the tab under it that names it once it is the book above.
 * A peek is tappable (it goes to that book); the front book's own gestures
 * are Book's.
 */
function ShelfSlot({
  index,
  count,
  pos,
  step,
  left,
  top,
  coverH,
  book,
  front,
  onTapPeek,
  children,
}: {
  index: number;
  count: number;
  pos: SharedValue<number>;
  step: number;
  left: number;
  top: number;
  coverH: number;
  book: BookInfo;
  front: boolean;
  onTapPeek: (d: number) => void;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const p = carouselPlacement(loopOffset(index, pos.value, count), step, count);
    return {
      opacity: p.opacity,
      transform: [{ perspective: 1400 }, { translateY: p.translateY }, { scale: p.scale }, { rotateX: `${p.rotateX}deg` }],
    };
  });
  const tabStyle = useAnimatedStyle(() => ({
    opacity: carouselPlacement(loopOffset(index, pos.value, count), step, count).bottomTab,
  }));
  const tap = Gesture.Tap()
    .enabled(!front)
    .maxDistance(FLIP.axisLockPx)
    .onEnd((_e, ok) => {
      if (!ok) return;
      const o = loopOffset(index, pos.value, count);
      runOnJS(onTapPeek)(o < 0 ? -1 : 1);
    });
  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        style={[slotStyles.slot, { left, top }, style]}
        accessibilityElementsHidden={!front}
        importantForAccessibility={front ? 'auto' : 'no-hide-descendants'}
        testID={front ? 'box-front' : `box-peek-${book.id}`}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={[slotStyles.bottomTab, { top: CAROUSEL.tabPx + coverH, backgroundColor: book.color }, tabStyle]}
        >
          <Text style={slotStyles.tabText} numberOfLines={1}>
            {book.name}
          </Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const slotStyles = StyleSheet.create({
  slot: { position: 'absolute' },
  bottomTab: {
    position: 'absolute',
    right: 14,
    height: CAROUSEL.tabPx,
    paddingHorizontal: 11,
    justifyContent: 'center',
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    maxWidth: '70%',
  },
  tabText: { color: '#fff', fontSize: 11, letterSpacing: 0.9, fontWeight: '600', textTransform: 'uppercase' },
});

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
    // Clips the peeks at its edges: the books above and below are glimpses,
    // and must not paint over the header or the page controls.
    stage: { flex: 1, overflow: 'hidden' },
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
    mid: { alignItems: 'center', gap: 8 },
    pages: { fontFamily: fonts.mono, fontSize: 12, color: colors.mutedForeground },
    rail: { flexDirection: 'row', gap: 6 },
    // The border token is for hairlines and all but vanishes as a 7px dot.
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mutedForeground, opacity: 0.35 },
  });
}
