/**
 * components/recipeBox/Book.tsx — one book of the Recipe Box, open to a
 * spread of two recipes, whose pages turn under the finger.
 *
 * THE TURN IS SPLIT FACES (ROADMAP; proven on a real iPhone Sep 23). Each face
 * of the turning leaf is its own view, a single rotateY about the spine,
 * shown by angle: the front until 90°, the back after. The prototype's
 * structure — one leaf holding both faces with the back culled by
 * backfaceVisibility — mirrors the front through the page in React Native,
 * which renders every view as a flat layer.
 *
 * ONE CONTINUOUS POSITION, in spreads (CLAUDE.md): `pos` is k at rest on
 * spread k and k ± p mid-turn, and every face derives its angle from
 * `pos − the spread it belongs to`. So nothing is ever reset, and a turn can
 * be led by either side: the finger moves `pos` and tells the parent when it
 * lands; the ‹ › buttons (and anything else) change `spread`, and `pos`
 * animates after it. In both orders every frame is right — worked through at
 * the paint order below.
 *
 * PAINT ORDER IS JSX ORDER, no zIndex: the pages underneath, then the
 * backward leaf's front (page L, flat on the left at rest), the forward
 * leaf's front (L+1, flat on the right), the forward leaf's back (L+2, which
 * falls onto the left in the second half of a forward turn, so above L), and
 * the backward leaf's back (L−1, which falls onto the right in a backward
 * turn, so above L+1). One order, correct for both directions.
 *
 * Touch: gesture-handler's Pan and Tap race for the spread; no page is ever a
 * Pressable. The pan's direction locks on the first update that has actually
 * MOVED — the one that activates it can report 0, which read every drag as
 * backwards until the page-flip test screen (since retired) caught it.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BookPage, type PageContent } from '@/components/recipeBox/BookPage';
import {
  FLIP,
  bookGeometry,
  flipCommits,
  flipProgress,
  flipSettleMs,
  pageA11yLabel,
  turnTarget,
  spreadCount,
  type Book as BookInfo,
} from '@/lib/recipeBox';
import { useColors } from '@/hooks/useColors';
import type { Entry } from '@/lib/api';

const EASE = Easing.inOut(Easing.cubic);
const SHADE = '#3a2a18';

interface Props {
  book: BookInfo;
  pages: Entry[];
  /** The spread it is open to — owned by the parent, which remembers one
   *  per book. */
  spread: number;
  onSpreadChange: (k: number) => void;
  onOpenPage: (entry: Entry) => void;
  onBlankPage: () => void;
  /** The book's width; everything else follows (`bookGeometry`). The
   *  carousel picks it to fit the stage. */
  width: number;
  /** For VoiceOver's next/previous book actions (the shelf wires them). */
  onNextBook?: () => void;
  onPrevBook?: () => void;
  /** Outline this page in the book's colour, fading over ~1.8s — where a
   *  search result landed. A new token replays it. */
  highlight?: { page: number; token: number } | null;
  /** Only the book in front takes touches; the peeking ones are pictures,
   *  drawn with just their two visible pages and hidden from VoiceOver. */
  interactive?: boolean;
}

export function Book({ book, pages, spread, onSpreadChange, onOpenPage, onBlankPage, width, onNextBook, onPrevBook, highlight = null, interactive = true }: Props) {
  const colors = useColors();
  const { bookW, pageW, pageH } = bookGeometry(width);
  const reduceMotion = useReducedMotion();
  const n = pages.length;
  const last = spreadCount(n) - 1;

  const pos = useSharedValue(spread);
  const busy = useSharedValue(false);
  const lastSV = useSharedValue(last);
  lastSV.value = last;
  const start = useSharedValue(0);
  const dir = useSharedValue(0);
  const t0 = useSharedValue(0);
  const nudge = useSharedValue(0);
  const fade = useSharedValue(1);
  const ignored = useSharedValue(false);
  const tapIgnored = useSharedValue(false);

  // The JS side of the gestures, read through refs so that the gestures
  // themselves are built ONCE (below). Rebuilding them on every render
  // replaced the handlers mid-touch whenever a turn landed and re-rendered
  // the book — a quick second swipe then ended as a TAP, and on the last
  // spread that tap was "Room for one more", which opened Find.
  const spreadRef = useRef(spread);
  spreadRef.current = spread;
  const onSpreadChangeRef = useRef(onSpreadChange);
  onSpreadChangeRef.current = onSpreadChange;
  const openAtRef = useRef<(x: number) => void>(() => {});
  openAtRef.current = (x: number) => {
    const i = 2 * spread + (x < pageW ? 0 : 1);
    if (i < n) onOpenPage(pages[i]);
    else if (i === n && n % 2 === 1) onBlankPage();
  };

  const committed = useCallback(
    (to: number) => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onSpreadChangeRef.current(to);
      // `busy` is released when the new spread arrives as a prop. If it never
      // does — the parent chose otherwise — go back to the spread the parent
      // says we are on rather than stay locked on a page nobody can see.
      setTimeout(() => {
        if (spreadRef.current !== to) {
          pos.value = spreadRef.current;
          busy.value = false;
        }
      }, 150);
    },
    [pos, busy]
  );
  const openAt = useCallback((x: number) => openAtRef.current(x), []);

  // The spread changed from outside (the ‹ › buttons, a search jump, a
  // VoiceOver action): turn to it. One spread away animates as a real turn;
  // further, or with Reduce Motion, a short crossfade — a five-page flurry
  // of leaves helps nobody. After the finger's own turn `pos` already equals
  // `spread`, and nothing happens.
  useEffect(() => {
    const from = pos.value;
    if (from === spread) {
      busy.value = false;
      return;
    }
    busy.value = true;
    if (reduceMotion || Math.abs(spread - from) > 1) {
      fade.value = withTiming(0.4, { duration: 90 }, () => {
        pos.value = spread;
        busy.value = false;
        fade.value = withTiming(1, { duration: 180 });
      });
      return;
    }
    const p = Math.abs(spread - from);
    pos.value = withTiming(spread, { duration: flipSettleMs(1 - p, true), easing: EASE }, () => {
      busy.value = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spread]);

  // A touch that lands while a page is still settling is IGNORED, pan and
  // tap alike, as the prototype did. Letting it take over mid-settle is what
  // broke the book on the phone: it started from a fractional position, the
  // turn landed between two spreads (two empty pages), and nothing could
  // ever release it. `turnTarget` also only ever names a whole spread.
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(interactive)
      .activeOffsetX([-FLIP.axisLockPx, FLIP.axisLockPx])
      .failOffsetY([-FLIP.axisLockPx, FLIP.axisLockPx])
      .onBegin(() => {
        ignored.value = busy.value;
        start.value = Math.round(pos.value);
        dir.value = 0;
        t0.value = Date.now();
      })
      .onUpdate((e) => {
        if (ignored.value || busy.value) return;
        if (dir.value === 0) {
          if (Math.abs(e.translationX) < 1) return;
          dir.value = e.translationX < 0 ? 1 : -1;
        }
        const d = dir.value as 1 | -1;
        if (turnTarget(start.value, d, lastSV.value) === null) {
          // The first or last spread: the spread gives a little, no turn.
          nudge.value = e.translationX * FLIP.edgeRubber;
          return;
        }
        if (reduceMotion) return; // nothing turns under the finger; it fades on release
        pos.value = start.value + d * flipProgress(e.translationX, d, bookW);
      })
      .onEnd((e) => {
        if (nudge.value !== 0) nudge.value = withSpring(0, { damping: 18, stiffness: 220 });
        if (ignored.value || busy.value || dir.value === 0) return;
        const d = dir.value as 1 | -1;
        const target = turnTarget(start.value, d, lastSV.value);
        if (target === null) return;
        const p = flipProgress(e.translationX, d, bookW);
        const commit = flipCommits(p, Date.now() - t0.value, e.translationX);
        const to = commit ? target : start.value;
        busy.value = true;
        if (reduceMotion) {
          if (!commit) {
            busy.value = false;
            return;
          }
          fade.value = withTiming(0.4, { duration: 90 }, () => {
            pos.value = to;
            runOnJS(committed)(to);
            fade.value = withTiming(1, { duration: 180 });
          });
          return;
        }
        // Busy for the whole settle, either way; a commit stays busy until
        // the new spread arrives as a prop (the effect above releases it).
        pos.value = withTiming(to, { duration: flipSettleMs(p, commit), easing: EASE }, (done) => {
          if (commit) runOnJS(committed)(to);
          else busy.value = false;
          void done;
        });
      });

    const tap = Gesture.Tap()
      .enabled(interactive)
      .maxDistance(FLIP.axisLockPx)
      .onBegin(() => {
        tapIgnored.value = busy.value;
      })
      .onEnd((e, ok) => {
        if (ok && !busy.value && !tapIgnored.value) runOnJS(openAt)(e.x);
      });

    return Gesture.Race(pan, tap);
    // The shared values and the two stable callbacks never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, bookW, reduceMotion]);


  const content = useCallback(
    (i: number): PageContent => {
      if (i >= 0 && i < n) return { kind: 'recipe', entry: pages[i], number: i + 1 };
      if (i === n && n % 2 === 1) return { kind: 'blank' };
      return { kind: 'empty' };
    },
    [n, pages]
  );

  const spreadStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: nudge.value }] }));

  const L = 2 * spread;
  const leaf = { k: spread, pos, pageW, pageH, book };
  const dark = colors.scheme === 'dark';

  // VoiceOver: one element per visible page, with the navigation a swipe
  // would give. The drawn pages themselves are hidden from it — several are
  // stacked out of sight at any moment, and it must never read those.
  const a11yActions = useMemo(
    () => [
      { name: 'activate' },
      { name: 'nextPage', label: 'Next pages' },
      { name: 'previousPage', label: 'Previous pages' },
      ...(onNextBook ? [{ name: 'nextBook', label: 'Next book' }] : []),
      ...(onPrevBook ? [{ name: 'previousBook', label: 'Previous book' }] : []),
    ],
    [onNextBook, onPrevBook]
  );
  const onA11y = (i: number) => (event: { nativeEvent: { actionName: string } }) => {
    switch (event.nativeEvent.actionName) {
      case 'activate':
        if (i < n) onOpenPage(pages[i]);
        else if (i === n && n % 2 === 1) onBlankPage();
        break;
      case 'nextPage':
        if (spread < last) onSpreadChange(spread + 1);
        break;
      case 'previousPage':
        if (spread > 0) onSpreadChange(spread - 1);
        break;
      case 'nextBook':
        onNextBook?.();
        break;
      case 'previousBook':
        onPrevBook?.();
        break;
    }
  };
  const a11yLabel = (i: number): string =>
    i < n
      ? `${pageA11yLabel(pages[i].recipe.title, book.name, pages[i].recipe, pages[i].rating)}, page ${i + 1} of ${n}`
      : i === n && n % 2 === 1
        ? `Room for one more ${book.name} recipe. Opens Find.`
        : '';

  return (
    <View style={{ width: bookW, paddingTop: 22 }} testID={`book-${book.id}`}>
      <View style={[styles.tab, { backgroundColor: book.color }]} testID="book-tab">
        <Text style={styles.tabText} numberOfLines={1}>
          {book.name}
        </Text>
      </View>
      <View
        style={[
          styles.cover,
          { backgroundColor: book.color },
          dark ? styles.coverRimDark : null,
        ]}
      >
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{ width: pageW * 2, height: pageH }, spreadStyle]} testID="book-spread">
            <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {/* 1. Underneath: what a turn reveals. Covered at rest, and a
                  peeking book never turns, so it draws only its two faces. */}
              {interactive ? (
                <>
                  <View style={[styles.slot, { left: 0 }]}>
                    <BookPage content={content(L - 2)} side="left" book={book} width={pageW} height={pageH} />
                  </View>
                  <View style={[styles.slot, { left: pageW }]}>
                    <BookPage content={content(L + 3)} side="right" book={book} width={pageW} height={pageH} />
                  </View>
                </>
              ) : null}
              {/* 2–5: the four faces, in the one order right for both ways. */}
              <Face {...leaf} role="bwd-front" content={content(L)} />
              <Face {...leaf} role="fwd-front" content={content(L + 1)} />
              {interactive ? <Face {...leaf} role="fwd-back" content={content(L + 2)} /> : null}
              {interactive ? <Face {...leaf} role="bwd-back" content={content(L - 1)} /> : null}
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(60,40,20,0)', 'rgba(60,40,20,0.06)', 'rgba(60,40,20,0.1)', 'rgba(60,40,20,0.06)', 'rgba(60,40,20,0)']}
                locations={[0, 0.42, 0.5, 0.58, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.spine, { left: pageW - 8, height: pageH }]}
              />
            </View>
            {highlight && interactive && Math.floor(highlight.page / 2) === spread ? (
              <PageOutline
                key={highlight.token}
                left={highlight.page % 2 === 0 ? 0 : pageW}
                width={pageW}
                height={pageH}
                color={book.color}
              />
            ) : null}
            {/* What VoiceOver sees instead: the two visible pages. */}
            {(interactive ? [L, L + 1] : []).map((i, side) =>
              a11yLabel(i) ? (
                <View
                  key={i}
                  style={[styles.slot, { left: side === 0 ? 0 : pageW, width: pageW, height: pageH }]}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={a11yLabel(i)}
                  accessibilityActions={a11yActions}
                  onAccessibilityAction={onA11y(i)}
                  testID={`book-a11y-${side === 0 ? 'left' : 'right'}`}
                />
              ) : null
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** The prototype's search highlight: an outline inset 4px, in the book's
 *  colour, in over the first 15%, held to 70%, gone by 1.8s. It never
 *  takes a touch. Reduce Motion keeps it, without the fade in. */
function PageOutline({ left, width, height, color }: { left: number; width: number; height: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const o = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    o.value = withSequence(
      withTiming(1, { duration: reduceMotion ? 0 : 270 }),
      withTiming(1, { duration: 990 }),
      withTiming(0, { duration: 540 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.slot, { left: left + 4, top: 4, width: width - 8, height: height - 8, borderRadius: 7, borderWidth: 2.5, borderColor: color }, style]}
      testID="book-highlight"
    />
  );
}

/** How far through a turn the leaves of spread k are: forward 0→1 as pos
 *  goes k→k+1, backward 0→1 as it goes k→k−1. */
function progressOf(pos: number, k: number, role: 'fwd' | 'bwd'): number {
  'worklet';
  const f = role === 'fwd' ? pos - k : k - pos;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function Face({
  role,
  content,
  k,
  pos,
  pageW,
  pageH,
  book,
}: {
  role: 'fwd-front' | 'fwd-back' | 'bwd-front' | 'bwd-back';
  content: PageContent;
  k: number;
  pos: SharedValue<number>;
  pageW: number;
  pageH: number;
  book: BookInfo;
}) {
  const fwd = role.startsWith('fwd');
  const front = role.endsWith('front');
  // Which half it lies on when flat, and so which edge is the spine it
  // hinges on: a forward leaf's front is a right-hand page and its back a
  // left-hand one; a backward leaf is the mirror.
  const onRight = fwd === front;
  const style = useAnimatedStyle(() => {
    const p = progressOf(pos.value, k, fwd ? 'fwd' : 'bwd');
    const sign = onRight ? -1 : 1;
    const deg = front ? sign * 180 * p : sign * 180 * (1 - p);
    return {
      opacity: (front ? p < 0.5 : p >= 0.5) ? 1 : 0,
      transform: [{ perspective: 1600 }, { rotateY: `${deg}deg` }],
    };
  });
  // The warm shadow a turning page catches, deepest when it stands upright.
  const shade = useAnimatedStyle(() => {
    const p = progressOf(pos.value, k, fwd ? 'fwd' : 'bwd');
    const s = Math.sin(Math.PI * p) * 0.3;
    return { opacity: front ? (p < 0.5 ? s : 0) : p >= 0.5 ? s : 0 };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.slot,
        { left: onRight ? pageW : 0, width: pageW, height: pageH, transformOrigin: onRight ? '0% 50%' : '100% 50%' },
        style,
      ]}
      testID={`book-face-${role}`}
    >
      <BookPage content={content} side={onRight ? 'right' : 'left'} book={book} width={pageW} height={pageH} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SHADE }, shade]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: 'absolute',
    top: 0,
    left: 14,
    height: 22,
    paddingHorizontal: 11,
    justifyContent: 'center',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    maxWidth: '70%',
  },
  tabText: { color: '#fff', fontSize: 11, letterSpacing: 0.9, fontWeight: '600', textTransform: 'uppercase' },
  cover: {
    borderRadius: 10,
    paddingTop: 7,
    paddingHorizontal: 7,
    paddingBottom: 9,
    // Lighter than the prototype's (0.28 / 13 / 12): with three books on
    // screen, three full drop shadows read as heavy.
    shadowColor: '#28190a',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  // A drop shadow vanishes on a dark page, so the book gets a faint light
  // edge instead to sit apart from it.
  coverRimDark: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  slot: { position: 'absolute', top: 0 },
  spine: { position: 'absolute', top: 0, width: 16 },
});
