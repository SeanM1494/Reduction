/**
 * components/library/CardStack.tsx — the recipe box as a stack: one card
 * fills the stage, the next two peek behind it, a swipe left flips to the
 * next, a swipe right back, a tap opens. Within whatever the category tab
 * has selected.
 *
 * Built on PanResponder and Animated from React Native itself — no gesture
 * library, so nothing new for the build. The gesture policy (how far or
 * fast commits) is pure, in lib/libraryViewMode.ts, under test; this file
 * is the animation around it.
 *
 * Two rules here were learned the hard way, both invisible in Chromium:
 *
 * EVERY CARD IS AN ABSOLUTELY POSITIONED SIBLING AND PAINT ORDER IS JSX
 * ORDER. The first cut drew the peeks absolutely and the top card in flow,
 * ordering them with `zIndex`/`elevation`. On a real iPhone the peeks
 * painted OVER the top card: the visible card was the one behind, with a
 * third card's title ghosting through its translucent neighbour, and the
 * card being dragged was invisible. zIndex against a statically positioned
 * sibling is not a promise any of the three platforms makes the same way;
 * document order among absolute siblings is. Deepest peek first, top card
 * last, and no zIndex anywhere.
 *
 * THE PAN CAPTURES THE TOUCH. RecipeCard is a Pressable, so it wins the
 * responder on touch-down and the pan never starts — swiping did nothing at
 * all. The capture-phase handlers run root-downward, so the top card's
 * wrapper takes the gesture before the Pressable is asked, and the tap is
 * handled here too (the card's own onPress is deliberately inert). That also
 * settles it against any ancestor scroller, which is why the screen renders
 * this as a sibling of the list rather than inside it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RecipeCard } from '@/components/library/RecipeCard';
import { stackStep, swipeOutcome, TAP_SLOP_PX } from '@/lib/libraryViewMode';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

/** How many cards peek behind the top one. */
const PEEK = 2;

export function CardStack({ entries, onOpen }: { entries: Entry[]; onOpen: (id: string) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width: windowW } = useWindowDimensions();
  const cardW = Math.min(windowW - 48, 420);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const countRef = useRef(entries.length);
  countRef.current = entries.length;
  // A filter change can shrink the list under the index: clamp, do not reset,
  // so switching tabs and back keeps the place.
  useEffect(() => {
    const clamped = stackStep(indexRef.current, 'stay', entries.length);
    if (clamped !== indexRef.current) {
      indexRef.current = clamped;
      setIndex(clamped);
    }
  }, [entries.length]);

  const drag = useRef(new Animated.ValueXY()).current;
  const settle = (outcome: 'next' | 'prev' | 'stay') => {
    const from = indexRef.current;
    const to = stackStep(from, outcome, countRef.current);
    if (to === from) {
      Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 6 }).start();
      return;
    }
    // Fly the top card off in the swipe's direction, then reset under the
    // next card. The reset is instant and invisible: by then the flown card
    // is the one BEHIND, drawn at the peek offset.
    Animated.timing(drag, {
      toValue: { x: (outcome === 'next' ? -1 : 1) * (cardW + 80), y: 0 },
      duration: 180,
      useNativeDriver: false,
    }).start(() => {
      indexRef.current = to;
      setIndex(to);
      drag.setValue({ x: 0, y: 0 });
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Capture phase, so the card's own Pressable never takes the touch
        // and no ancestor can either. The tap below is the replacement.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => drag.setValue({ x: g.dx, y: g.dy * 0.15 }),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < TAP_SLOP_PX && Math.abs(g.dy) < TAP_SLOP_PX) {
            drag.setValue({ x: 0, y: 0 });
            const cur = entries[indexRef.current];
            if (cur) onOpen(cur.id);
            return;
          }
          settle(swipeOutcome(g.dx, g.vx, cardW));
        },
        onPanResponderTerminate: () => settle('stay'),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, cardW]
  );

  if (!entries.length) return null;
  const rotate = drag.x.interpolate({ inputRange: [-cardW, 0, cardW], outputRange: ['-6deg', '0deg', '6deg'] });

  // Back to front. The deepest card is first in the list and the top card
  // last, because that is the paint order — see the header.
  const layers: Array<{ entry: Entry; depth: number }> = [];
  for (let depth = PEEK; depth >= 1; depth -= 1) {
    const e = entries[index + depth];
    if (e) layers.push({ entry: e, depth });
  }
  layers.push({ entry: entries[index], depth: 0 });

  return (
    <View style={styles.stage} testID="library-stack">
      <View style={[styles.deck, { width: cardW }]}>
        {layers.map(({ entry, depth }) =>
          depth === 0 ? (
            <Animated.View
              key={entry.id}
              {...responder.panHandlers}
              style={[styles.layer, { transform: [{ translateX: drag.x }, { translateY: drag.y }, { rotate }] }]}
              testID="stack-top"
            >
              {/* Inert on purpose: the pan above owns the tap. */}
              <RecipeCard entry={entry} layout="stack" onPress={() => {}} />
            </Animated.View>
          ) : (
            <View
              key={entry.id}
              pointerEvents="none"
              style={[
                styles.layer,
                { transform: [{ scale: 1 - depth * 0.05 }, { translateY: -depth * 14 }], opacity: 1 - depth * 0.08 },
              ]}
              testID={`stack-peek-${depth}`}
            >
              <RecipeCard entry={entry} layout="stack" onPress={() => {}} />
            </View>
          )
        )}
      </View>
      <Text style={styles.counter} testID="stack-counter">
        {index + 1} of {entries.length}
        {index + 1 < entries.length ? '  ·  swipe left for the next' : index > 0 ? '  ·  swipe right to go back' : ''}
      </Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The stage takes the height its parent gives it and the deck takes the
    // rest after the counter, so nothing here measures anything: the card's
    // height is flex, not a number read back from a layout event one frame
    // late. The top padding is the room the peeks rise into.
    stage: { flex: 1, alignItems: 'center', paddingTop: 30, paddingBottom: 4 },
    deck: { flex: 1, maxHeight: 620, alignSelf: 'center' },
    layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    counter: { marginTop: 14, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4, color: colors.mutedForeground },
  });
}
