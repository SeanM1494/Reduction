/**
 * components/demo/TapPointer.tsx — "Watch instead"'s pointer: a hand that
 * glides onto a target, and a ring that expands where it taps.
 *
 * Drawn INSIDE the target (a diagram cell, a finish-strip step, the
 * Step-by-Step tab, Next Step), like the spotlight ring, never at a screen
 * position: it moves with the sideways-scrolling diagram and stays put in
 * the pinned first column because the cell it is in does. It also stays
 * INSIDE the target's box: a cell later in the table is drawn after this
 * one and would cover anything that spilled into it (CLAUDE.md, layered
 * things are back-to-front siblings), so the hand arrives from the upper
 * left, over its own cell, and the ring is sized to the cell.
 *
 * The pace is lib/demoWatch.ts's. Under Reduce Motion nothing glides or
 * grows: the hand is simply on the target, and the ring is drawn still.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { paceFor } from '@/lib/demoWatch';
import type { Pointer } from '@/lib/spotlight';

/** The hand's box, and its fingertip within it: the point that taps. */
const HAND_W = 20;
const HAND_H = 26;
const TIP_X = 8.5;
const TIP_Y = 1;
/** Where the glide starts, relative to the target's centre. */
const FROM = { x: -18, y: -14 };
/** The tap ring's largest size. */
const RING = 34;

export function TapPointer({ pointer }: { pointer: Pointer }) {
  const colors = useColors();
  const reduceMotion = pointer.still;
  const pace = paceFor({ reduceMotion });
  const glide = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;

  // A new approach starts from the beginning.
  useEffect(() => {
    ring.setValue(0);
    press.setValue(0);
    if (reduceMotion) {
      glide.setValue(1);
      return;
    }
    glide.setValue(0);
    const a = Animated.timing(glide, {
      toValue: 1,
      duration: Math.round(pace.glideMs * 0.85),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [pointer.seq, reduceMotion, glide, ring, press, pace.glideMs]);

  // The tap: the hand presses, the ring grows and fades — or, under Reduce
  // Motion, the ring is simply there.
  useEffect(() => {
    if (pointer.phase !== 'tap') return;
    if (reduceMotion) {
      ring.setValue(0.6);
      return;
    }
    ring.setValue(0);
    press.setValue(0);
    const a = Animated.parallel([
      Animated.timing(ring, { toValue: 1, duration: pace.tapMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(press, { toValue: 1, duration: Math.round(pace.tapMs * 0.3), useNativeDriver: true }),
        Animated.timing(press, { toValue: 0, duration: Math.round(pace.tapMs * 0.4), useNativeDriver: true }),
      ]),
    ]);
    a.start();
    return () => a.stop();
  }, [pointer.phase, pointer.seq, reduceMotion, ring, press, pace.tapMs]);

  const tx = glide.interpolate({ inputRange: [0, 1], outputRange: [FROM.x, 0] });
  const ty = glide.interpolate({ inputRange: [0, 1], outputRange: [FROM.y, 0] });
  const handScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const ringScale = reduceMotion ? 1 : ring.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const ringOpacity = reduceMotion
    ? ring.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 0.9] })
    : ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="tap-pointer" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.ring,
          { borderColor: colors.foreground, opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
        testID={pointer.phase === 'tap' ? 'tap-ring' : undefined}
      />
      <Animated.View style={[styles.hand, { transform: [{ translateX: tx }, { translateY: ty }, { scale: handScale }] }]}>
        <Hand />
      </Animated.View>
    </View>
  );
}

/** A pointing hand: the index finger up, three fingers curled, the thumb.
 *  Cream with a dark outline in both themes — an object over the page,
 *  like the Recipe Box's paper — so it reads on amber, green and gray. */
function Hand() {
  const fill = '#fffdf6';
  const ink = '#2a2118';
  return (
    <Svg width={HAND_W} height={HAND_H} viewBox="0 0 20 26">
      {/* Shadow, a little down and right. */}
      <Path d="M8 3 v9 h9 a2 2 0 0 1 2 2 v5 a6 6 0 0 1 -6 6 h-5 a5 5 0 0 1 -4.5 -3 l-2.5 -6 a2 2 0 0 1 3.4 -2 l1.6 2 v-13 a2 2 0 0 1 4 0 z" fill="rgba(40,25,10,0.25)" transform="translate(1.2 1.4)" />
      {/* Curled fingers, behind the palm's edge. */}
      <Rect x={10.5} y={9} width={3.6} height={7} rx={1.8} fill={fill} stroke={ink} strokeWidth={1.2} />
      <Rect x={13.6} y={10} width={3.6} height={7} rx={1.8} fill={fill} stroke={ink} strokeWidth={1.2} />
      <Rect x={16.2} y={11.5} width={3.2} height={6} rx={1.6} fill={fill} stroke={ink} strokeWidth={1.2} />
      {/* Index finger, palm and thumb as one outline. */}
      <Path
        d="M6.5 2.6 a2 2 0 0 1 4 0 v9.4 h6.6 a2 2 0 0 1 2 2 v4.8 a6 6 0 0 1 -6 6 h-4.6 a5 5 0 0 1 -4.4 -2.8 l-2.6 -5.6 a1.9 1.9 0 0 1 3.2 -2 l1.8 2.2 z"
        fill={fill}
        stroke={ink}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: RING,
    height: RING,
    marginLeft: -RING / 2,
    marginTop: -RING / 2,
    borderRadius: RING / 2,
    borderWidth: 3,
  },
  hand: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: HAND_W,
    height: HAND_H,
    marginLeft: -TIP_X,
    marginTop: -TIP_Y,
  },
});
