/**
 * components/Sheet.tsx — the bottom sheet every small dialog in the app uses.
 *
 * One shape, ported from the web's `.rd-sheet`: a scrim that closes on tap, a
 * card rising from the bottom edge with a grab handle, a title row with one
 * action on the right ("Done" by default), and the caller's content below.
 * Capped at 86% of the screen and scrolling past that, like the web.
 *
 * A Modal rather than a library sheet: nothing here needs gestures, and a
 * Modal works on iOS, Android and react-native-web alike, which is what lets
 * the Chromium sweep exercise it.
 *
 * THE MODAL DOES NO ANIMATION OF ITS OWN (Sep 24, on the phone). Its
 * "slide" moved the whole layer — the dark scrim included — so the shading
 * visibly rose up the screen behind the card: "the wash". Now the scrim
 * FADES where it is and only the card slides up, both from one progress
 * value, and closing reverses it before the Modal goes. Reduce Motion
 * keeps a short fade and does not slide. A dialog that asks something is a
 * centred window instead (components/Window.tsx).
 */

import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Label of the head's one action; it always closes. */
  closeLabel?: string;
  /** A sheet with text fields rises above the keyboard. */
  avoidKeyboard?: boolean;
  /** After it has finished closing and its Modal is gone — where the NEXT
   *  dialog opens from (see components/Window.tsx for why). */
  onClosed?: () => void;
  children: React.ReactNode;
}

const IN_MS = 260;
const OUT_MS = 200;

export function Sheet({ open, title, onClose, closeLabel = 'Done', avoidKeyboard, onClosed, children }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
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
  // What the sheet showed, kept on screen while it slides away after the
  // caller has already moved on.
  const last = useRef<{ title: string; children: React.ReactNode }>({ title, children });
  if (open) last.current = { title, children };

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = 0;
      progress.value = withTiming(1, { duration: reduceMotion ? 150 : IN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      progress.value = withTiming(0, { duration: reduceMotion ? 120 : OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // The card travels its own full height at most: the screen's height is
  // always enough to start it below the bottom edge.
  const cardStyle = useAnimatedStyle(() =>
    reduceMotion ? { opacity: progress.value } : { transform: [{ translateY: (1 - progress.value) * height }] }
  );

  if (!mounted) return null;
  const shown = open ? { title, children } : last.current;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrimTint, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView
        pointerEvents="box-none"
        style={styles.scrim}
        behavior={avoidKeyboard && Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={!!avoidKeyboard}
      >
        <Animated.View style={[styles.sheet, { maxHeight: height * 0.86, paddingBottom: 18 + insets.bottom }, cardStyle]}>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title}>{shown.title}</Text>
            <SheetButton label={closeLabel} onPress={onClose} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
            {shown.children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The web's `.rd-btn`: a small bordered button on the card colour. 44px
 *  tall whatever its label, because it sits under a thumb. */
export function SheetButton({
  label,
  onPress,
  danger,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, disabled && styles.btnDisabled]}
    >
      <Text style={[styles.btnText, danger && { color: colors.dangerInk }]}>{label}</Text>
    </Pressable>
  );
}

/** A labelled group inside a sheet: `.rd-field` with its label and hint. */
export function SheetField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {hint ? <Text style={styles.fieldHint}> {hint}</Text> : null}
      </Text>
      {children}
    </View>
  );
}

/** One option in a wrapped row of choices: `.rd-move-opt`, cool-tinted when
 *  current. */
export function SheetOption({
  label,
  current,
  disabled,
  onPress,
  role = 'button',
  testID,
}: {
  label: string;
  current: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** What the option IS to a screen reader: one of a set (radio), an
   *  independent toggle (checkbox), or a plain choice (button). */
  role?: 'button' | 'radio' | 'checkbox';
  testID?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ disabled }}
      {...(role === 'button' ? { 'aria-selected': current } : { 'aria-checked': current })}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.opt, current && styles.optCurrent, disabled && styles.btnDisabled]}
    >
      <Text style={[styles.optText, current && styles.optTextCurrent]}>{label}</Text>
    </Pressable>
  );
}

export function SheetNote({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return <Text style={styles.note}>{children}</Text>;
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end' },
    scrimTint: { backgroundColor: 'rgba(33, 29, 24, 0.42)' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: colors.border,
      paddingTop: 8,
      paddingHorizontal: 16,
      shadowColor: '#3a2418',
      shadowOpacity: 0.22,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -8 },
      elevation: 12,
    },
    grab: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 99,
      backgroundColor: colors.borderStrong,
      marginBottom: 10,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    title: { flex: 1, fontFamily: fonts.heading, fontSize: 17, color: colors.foreground },
    btn: {
      minHeight: 44,
      paddingHorizontal: 13,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    btnPressed: { borderColor: colors.borderStrong },
    btnDisabled: { opacity: 0.35 },
    btnText: { fontSize: 13, color: colors.foreground },
    field: { marginBottom: 14 },
    fieldLabel: { fontSize: 12.5, fontWeight: '600', color: colors.mutedForeground, marginBottom: 5 },
    fieldHint: { fontWeight: '400', color: colors.faint },
    opt: {
      minHeight: 44,
      paddingHorizontal: 13,
      paddingVertical: 8,
      justifyContent: 'center',
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    optCurrent: { backgroundColor: colors.coolBg, borderColor: colors.coolLine },
    optText: { fontSize: 13.5, color: colors.foreground },
    optTextCurrent: { color: colors.coolInk, fontWeight: '600' },
    note: { marginTop: 14, fontSize: 12.5, lineHeight: 18, color: colors.mutedForeground },
  });
}

export const optionRow = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
}).wrap;
