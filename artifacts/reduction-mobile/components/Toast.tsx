/**
 * components/Toast.tsx — one short message at the bottom of the screen, over
 * whatever screen is up: "Moved to the back of Dinner", or a snackbar with
 * an action, "Removed Weeknight Chili — Undo" for five seconds.
 *
 * It lives at the root, around the navigator, because the message usually
 * outlives the screen that raised it: removing a recipe leaves the recipe
 * screen, and the Undo has to be waiting in the library it lands in.
 *
 * One at a time; a new one replaces the old. It never takes a touch except
 * on its own action, and VoiceOver hears it as it appears.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export interface ToastSpec {
  message: string;
  action?: { label: string; onPress: () => void };
  durationMs?: number;
}

const ToastContext = createContext<(t: ToastSpec) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Above the tab bar (84 + the home indicator, as the tabs pad themselves)
 *  AND the Recipe Box's page controls under it (a 44px row plus padding) —
 *  an Undo that sits over the ‹ › buttons for five seconds hides the page
 *  label and half of both arrows. */
const ABOVE_TABS = 84 + 64;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastSpec & { key: number }) | null>(null);
  const shown = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    shown.value = withTiming(0, { duration: 180 });
    timer.current = setTimeout(() => setToast(null), 200);
  }, [shown]);

  const show = useCallback(
    (t: ToastSpec) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...t, key: Date.now() });
      shown.value = withTiming(1, { duration: 180 });
      AccessibilityInfo.announceForAccessibility(t.action ? `${t.message}. ${t.action.label} available.` : t.message);
      timer.current = setTimeout(hide, t.durationMs ?? (t.action ? 5000 : 1800));
    },
    [shown, hide]
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 8 }],
  }));

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: ABOVE_TABS + insets.bottom }, style]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.toast} testID="toast">
            <Text style={styles.text} numberOfLines={2} testID="toast-message">
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  toast.action?.onPress();
                  if (timer.current) clearTimeout(timer.current);
                  hide();
                }}
                style={styles.action}
                testID="toast-action"
              >
                <Text style={styles.actionText}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  // Dark in both themes, like the prototype: it has to stand off whatever
  // is under it, paper or night.
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 12,
    backgroundColor: '#2a2118',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  text: { flexShrink: 1, color: '#fff', fontSize: 14, paddingVertical: 12, paddingRight: 10 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#f3c77a', fontSize: 14, fontWeight: '700' },
});
