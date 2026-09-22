/**
 * components/library/CardStack.tsx — the recipe box as a deck you flip
 * through with your thumb: one card fills the stage, the next two peek
 * behind it, and a swipe carries the front card off while the ones behind
 * rise to meet you.
 *
 * ONE CONTINUOUS POSITION DRIVES EVERYTHING. `position` is a shared value
 * holding `index + how far through the swipe you are`, and every card's
 * transform is a pure function of `cardIndex - position`. That is what makes
 * the deck feel like a deck: the card behind grows and rises by exactly as
 * much as the front card has left, at every frame, rather than snapping when
 * the swipe commits. It also removes the reset that a per-card offset needs —
 * nothing is ever set back to zero, so there is no frame where a card is in
 * the wrong place. The whole thing runs on the UI thread (reanimated
 * worklets), so a slow render cannot stutter the drag.
 *
 * The policy is pure and tested, in lib/libraryViewMode.ts: `dragPosition`
 * (the 1:1 tracking and the rubber band at the ends), `swipeOutcome` (how
 * far or fast commits), `stackStep` (the clamped index) and `stackWindow`
 * (which cards are mounted, in paint order). This file is the animation
 * around those.
 *
 * PAINT ORDER IS JSX ORDER AND THERE IS NO zIndex. `stackWindow` returns the
 * cards deepest-first, so the last one rendered is the one on top — see
 * CLAUDE.md for the iPhone-only bug that rule exists to prevent. Note that
 * the card it puts on top is `index - 1`, not the front card: the card
 * before the front one is the one sliding in from the left when you swipe
 * back, and the one still flying off after a forward swipe commits.
 *
 * The gesture is gesture-handler's, not a PanResponder: RecipeCard is a
 * Pressable and won the responder on touch-down, so a PanResponder above it
 * never started. A Pan and a Tap racing settles that at the native layer,
 * and the card's own onPress is inert.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { RecipeCard } from '@/components/library/RecipeCard';
import {
  dragPosition,
  overscrollPx,
  stackStep,
  stackWindow,
  swipeOutcome,
  TAP_SLOP_PX,
} from '@/lib/libraryViewMode';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

/** Extra distance past the card's own width before it is clear of the
 *  screen. It is also the denominator the finger is tracked against, so
 *  the card stays exactly under the thumb. */
const GAP = 60;
/** How far each card behind sits above the one in front of it. */
const RISE = 14;
const SHRINK = 0.05;
const FADE = 0.09;
/** Firm enough to feel decisive, soft enough not to wobble. */
const SPRING = { damping: 19, stiffness: 165, mass: 0.7, overshootClamping: false } as const;

export function CardStack({ entries, onOpen }: { entries: Entry[]; onOpen: (id: string) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width: windowW } = useWindowDimensions();
  const cardW = Math.min(windowW - 48, 420);
  const travel = cardW + GAP;
  const count = entries.length;

  const [index, setIndex] = useState(0);
  const position = useSharedValue(0);
  // Dragging past either end moves the DECK, not the position: see
  // `overscrollPx` for why the two cannot be the same number.
  const overscroll = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  // The gesture's worklets need the count without re-creating the gesture
  // (which would drop an in-flight drag when the library refreshes).
  const countSV = useSharedValue(count);
  countSV.value = count;

  // The front card at tap time, for the tap worklet's hop back to JS.
  const frontRef = useRef<Entry | null>(entries[0] ?? null);
  frontRef.current = entries[index] ?? null;

  const settleAt = useCallback(
    (to: number, velocity: number) => {
      position.value = withSpring(to, { ...SPRING, velocity });
      setIndex(to);
    },
    [position]
  );

  const tick = useCallback(() => {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  // A filter change can shrink the list under the index: clamp, do not
  // reset, so switching category tabs and back keeps the place.
  useEffect(() => {
    const clamped = stackStep(index, 'stay', count);
    if (clamped !== index) {
      setIndex(clamped);
      position.value = withSpring(clamped, SPRING);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const openFront = useCallback(() => {
    const cur = frontRef.current;
    if (cur) onOpen(cur.id);
  }, [onOpen]);

  // `activeOffsetX` is what lets the Tap win a press that barely moved:
  // the Pan does not claim the gesture until the finger has travelled, and
  // `failOffsetY` hands a mostly-vertical drag back rather than eating it.
  const pan = Gesture.Pan()
    .activeOffsetX([-TAP_SLOP_PX, TAP_SLOP_PX])
    .failOffsetY([-28, 28])
    .onBegin(() => {
      gestureStart.value = position.value;
    })
    .onUpdate((e) => {
      position.value = dragPosition(gestureStart.value, e.translationX, travel, countSV.value);
      overscroll.value = overscrollPx(gestureStart.value, e.translationX, travel, countSV.value);
    })
    .onEnd((e) => {
      // velocityX is px/second; swipeOutcome speaks px/ms.
      const outcome = swipeOutcome(e.translationX, e.velocityX / 1000, cardW);
      const to = stackStep(Math.round(gestureStart.value), outcome, countSV.value);
      // Hand the spring the finger's own speed, in position units, so a
      // flick carries through instead of restarting from rest.
      if (to !== Math.round(gestureStart.value)) runOnJS(tick)();
      overscroll.value = withSpring(0, SPRING);
      runOnJS(settleAt)(to, -e.velocityX / travel);
    });

  const tap = Gesture.Tap()
    .maxDistance(TAP_SLOP_PX)
    .onEnd((_e, success) => {
      if (success) runOnJS(openFront)();
    });

  const gesture = Gesture.Race(pan, tap);

  const deckStyle = useAnimatedStyle(() => ({ transform: [{ translateX: overscroll.value }] }));

  if (!count) return null;

  const step = (delta: number) => {
    const to = stackStep(index, delta < 0 ? 'prev' : 'next', count);
    if (to !== index) {
      tick();
      settleAt(to, 0);
    }
  };

  return (
    <View style={styles.stage} testID="library-stack">
      <GestureDetector gesture={gesture}>
        <Animated.View style={[deckGeometry.deck, { width: cardW }, deckStyle]} testID="library-deck">
          {stackWindow(index, count).map((cardIndex) => (
            <StackCard
              key={entries[cardIndex].id}
              entry={entries[cardIndex]}
              cardIndex={cardIndex}
              position={position}
              travel={travel}
            />
          ))}
        </Animated.View>
      </GestureDetector>
      {/* The swipe is the point, but it must not be the ONLY way through:
          a deck you can only flip by dragging is unreachable to anyone who
          cannot drag, and awkward one-handed on a large phone. */}
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous recipe"
          onPress={() => step(-1)}
          disabled={index === 0}
          style={({ pressed }) => [styles.arrow, index === 0 && styles.arrowOff, pressed && styles.arrowPressed]}
          testID="stack-prev"
        >
          <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
        </Pressable>
        <Text style={styles.counter} testID="stack-counter">
          {index + 1} of {count}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next recipe"
          onPress={() => step(1)}
          disabled={index >= count - 1}
          style={({ pressed }) => [styles.arrow, index >= count - 1 && styles.arrowOff, pressed && styles.arrowPressed]}
          testID="stack-next"
        >
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One card, placed entirely by how far it is from the deck's position.
 * `d` is 0 for the front card, negative once it has been carried off to the
 * left, and 1, 2, 3 for the cards waiting behind. Every stop on that scale
 * is interpolated, which is why the deck moves as one thing.
 */
function StackCard({
  entry,
  cardIndex,
  position,
  travel,
}: {
  entry: Entry;
  cardIndex: number;
  position: SharedValue<number>;
  travel: number;
}) {
  const style = useAnimatedStyle(() => {
    const d = cardIndex - position.value;
    return {
      opacity: interpolate(d, [0, 1, 2, 3], [1, 1 - FADE, 1 - 2 * FADE, 0], Extrapolation.CLAMP),
      transform: [
        // Leaving to the left below zero; pinned at centre behind it, so the
        // cards in the deck do not slide sideways as the front one goes.
        { translateX: interpolate(d, [-1, 0, 1], [-travel, 0, 0], Extrapolation.CLAMP) },
        { translateY: interpolate(d, [-1, 0, 1, 2, 3], [0, 0, -RISE, -2 * RISE, -3 * RISE], Extrapolation.CLAMP) },
        {
          scale: interpolate(
            d,
            [-1, 0, 1, 2, 3],
            [1, 1, 1 - SHRINK, 1 - 2 * SHRINK, 1 - 3 * SHRINK],
            Extrapolation.CLAMP
          ),
        },
        { rotate: `${interpolate(d, [-1, 0, 1], [-11, 0, 0], Extrapolation.CLAMP)}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[deckGeometry.layer, style]}
      pointerEvents="none"
      testID={`stack-card-${cardIndex}`}
    >
      {/* Inert on purpose: the deck's Tap gesture owns the tap. */}
      <RecipeCard entry={entry} layout="stack" onPress={() => {}} />
    </Animated.View>
  );
}

/** The layer geometry is the same whatever the theme, so it is not rebuilt
 *  per render like the coloured styles below. */
const deckGeometry = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  deck: { flex: 1, maxHeight: 620, alignSelf: 'center' },
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The stage takes the height its parent gives it and the deck takes what
    // the footer leaves, so nothing measures anything: the card's height is
    // flex, not a number read back from a layout event one frame late. The
    // top padding is the room the cards behind rise into.
    stage: { flex: 1, alignItems: 'center', paddingTop: 30, paddingBottom: 4 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
    arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
    arrowOff: { opacity: 0.25 },
    arrowPressed: { backgroundColor: colors.muted },
    counter: {
      minWidth: 78,
      textAlign: 'center',
      fontFamily: fonts.mono,
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.mutedForeground,
    },
  });
}
