/**
 * components/library/CardStack.tsx — the recipe box as a stack: one card
 * fills the screen, the next two peek behind it, a swipe left flips to the
 * next, a swipe right back, a tap opens. Within whatever the category tab
 * has selected.
 *
 * Built on PanResponder and Animated from React Native itself — no gesture
 * library, so nothing new for the build. The gesture policy (how far or
 * fast commits) is pure, in lib/libraryViewMode.ts, under test; this file
 * is the animation around it. The top card is the only responder; the
 * peek cards are decoration and never receive touches.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RecipeCard } from '@/components/library/RecipeCard';
import { stackStep, swipeOutcome, TAP_SLOP_PX } from '@/lib/libraryViewMode';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

const PEEK = 2;

export function CardStack({ entries, onOpen, height }: { entries: Entry[]; onOpen: (id: string) => void; height?: number }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width: windowW } = useWindowDimensions();
  const cardW = Math.min(windowW - 48, 420);
  // The card must end above the tab bar on every phone with room for the
  // counter under it, so the screen tells the stack how tall the stage is
  // (the list's height less its header and the tab bar). A stage measured
  // from its own content would only ever measure the card it contains.
  // Without a height (nothing has laid out yet) a 4:3 face plus body.
  const [ownH, setOwnH] = useState(0);
  const stageH = height ?? ownH;
  const cardH = stageH ? Math.max(200, Math.min(stageH - 30 - 44, cardW * 1.25)) : Math.round(cardW * 0.75) + 70;
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
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
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
  const top = entries[index];
  const behind = entries.slice(index + 1, index + 1 + PEEK);
  const rotate = drag.x.interpolate({ inputRange: [-cardW, 0, cardW], outputRange: ['-6deg', '0deg', '6deg'] });

  return (
    <View style={[styles.stage, height ? { height } : null]} testID="library-stack" onLayout={(e) => setOwnH(e.nativeEvent.layout.height)}>
      <View style={[styles.deck, { width: cardW, height: cardH }]}>
        {/* Peek cards, deepest first so the top card paints last. */}
        {[...behind].reverse().map((e, i) => {
          const depth = behind.length - i; // 1 = directly behind the top
          return (
            <View
              key={e.id}
              pointerEvents="none"
              // Painted under the top card whatever the platform's default
              // order for absolute children: an explicit z-order.
              style={[styles.peek, { zIndex: 10 - depth, elevation: 10 - depth, transform: [{ scale: 1 - depth * 0.05 }, { translateY: -depth * 14 }], opacity: 1 - depth * 0.15 }]}
              testID={`stack-peek-${depth}`}
            >
              <RecipeCard entry={e} layout="stack" height={cardH} onPress={() => {}} />
            </View>
          );
        })}
        <Animated.View
          {...responder.panHandlers}
          style={[styles.top, { transform: [{ translateX: drag.x }, { translateY: drag.y }, { rotate }] }]}
          testID="stack-top"
        >
          <RecipeCard entry={top} layout="stack" height={cardH} onPress={() => onOpen(top.id)} />
        </Animated.View>
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
    stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 30, paddingBottom: 4 },
    deck: { alignSelf: 'center' },
    peek: { position: 'absolute', left: 0, right: 0, top: 0 },
    top: { width: '100%', zIndex: 20, elevation: 20 },
    counter: { marginTop: 14, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4, color: colors.mutedForeground },
  });
}
