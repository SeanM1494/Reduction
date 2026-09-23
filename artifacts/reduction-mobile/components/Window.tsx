/**
 * components/Window.tsx — a dialog as a centred window: the scrim FADES in
 * where it is and the card fades in from 94% scale, both from one progress
 * value; closing reverses it. The Modal itself does no animation.
 *
 * Decided on the phone (Sep 24): the app's Sheet slides the whole Modal
 * layer up from the bottom, so its dark scrim visibly rises up the screen
 * behind the card — "a wash". Every new dialog uses this instead; the sweep
 * of the older sheets is in ROADMAP.
 *
 * `instant` closes without the fade, for a close that is really a
 * navigation: a card still fading over the screen being pushed underneath
 * is the same kind of seam. Reduce Motion keeps a short fade, no scale.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useColors, type Colors } from '@/hooks/useColors';

const IN_MS = 220;
const OUT_MS = 160;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Close without fading (read when `open` goes false). */
  instant?: boolean;
  maxWidth?: number;
  /** Padding inside the card; the preview's photo wants less. */
  padding?: number;
  testID?: string;
  /** After it has finished closing and its Modal is gone. Open the NEXT
   *  dialog from here, never in the same breath as closing this one: iOS
   *  can refuse to present a Modal while another is still dismissing, or
   *  take the new one down with the old. */
  onClosed?: () => void;
  children: React.ReactNode;
}

export function Window({ open, onClose, instant = false, maxWidth = 440, padding = 18, testID, onClosed, children }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const wasMounted = useRef(open);
  useEffect(() => {
    if (wasMounted.current && !mounted) onClosedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted]);
  // What was shown, kept on screen while it fades out after the parent has
  // already moved on to nothing.
  const last = useRef<React.ReactNode>(children);
  if (open) last.current = children;

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = 0;
      progress.value = withTiming(1, { duration: reduceMotion ? 150 : IN_MS, easing: Easing.out(Easing.cubic) });
    } else if (instant) {
      progress.value = 0;
      setMounted(false);
    } else {
      progress.value = withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: reduceMotion ? 1 : 0.94 + 0.06 * progress.value }],
  }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" testID={testID ? `${testID}-scrim` : undefined} />
      </Animated.View>
      <View pointerEvents="box-none" style={[styles.center, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Animated.View
          style={[styles.card, { width: Math.min(width - 32, maxWidth), maxHeight: height - insets.top - insets.bottom - 32 }, cardStyle]}
          accessibilityViewIsModal
          testID={testID}
        >
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding }}>
            {open ? children : last.current}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    scrim: { backgroundColor: 'rgba(33, 29, 24, 0.42)' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      shadowColor: '#3a2418',
      shadowOpacity: 0.22,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
  });
}
