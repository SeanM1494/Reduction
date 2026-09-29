/**
 * components/demo/SpotRing.tsx — the demo guide's ring on a CONTROL (the
 * Step-by-Step tab, Next step). The diagram draws its own ring inside the
 * cell (DiagramView's `spot`); this is the same ring for a button, placed
 * inside the button so it moves with it and is never measured.
 *
 * A solid ring and a halo that breathes, opacity only. Under Reduce Motion
 * the halo holds still: the ring alone says "here".
 */

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

const PULSE_MS = 2400; // the diagram's ready pulse

export function SpotRing({ radius }: { radius: number }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 0.1, duration: PULSE_MS / 2, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0.55, duration: PULSE_MS / 2, useNativeDriver: true }),
          ])
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderRadius: radius, borderColor: colors.foreground }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { borderRadius: radius + 3, borderColor: colors.foreground, opacity: pulse }]}
        testID="spot-halo"
      />
    </>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3 },
  halo: { position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderWidth: 3 },
});
