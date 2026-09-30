/**
 * components/settings/FeedbackRow.tsx — Settings › Send feedback: an email
 * to the legal pages' contact, with the facts a report needs already in it
 * (lib/feedback.ts says which, and what is deliberately left out).
 *
 * `Linking.openURL` in a try, and never `canOpenURL` first: for `mailto:`
 * iOS answers canOpenURL only for schemes listed in the Info.plist's
 * LSApplicationQueriesSchemes — a native change — while openURL needs no
 * entry. When opening fails (no mail app), the address is copied instead
 * and a toast says so. When iOS's Mail is installed with no account, it is
 * Mail that says so, and openURL has already succeeded; nothing here can
 * see that case.
 *
 * The facts are read at the tap, each from a module that might not be in
 * an older binary, so each is required lazily and falls back to "unknown"
 * rather than taking Settings down (the same reasoning as AccountId's
 * clipboard).
 */

import React, { useCallback } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/Toast';
import { loadClipboard } from '@/components/settings/AccountId';
import { FEEDBACK_EMAIL, feedbackMailto, type FeedbackInfo } from '@/lib/feedback';

type UpdatesModule = { runtimeVersion?: string | null; updateId?: string | null; isEmbeddedLaunch?: boolean };
type DeviceModule = { modelName?: string | null; osVersion?: string | null };

function load<T>(name: 'expo-updates' | 'expo-device'): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (name === 'expo-updates' ? require('expo-updates') : require('expo-device')) as T;
  } catch {
    return null;
  }
}

export function feedbackInfo(): FeedbackInfo {
  const updates = load<UpdatesModule>('expo-updates');
  const device = load<DeviceModule>('expo-device');
  return {
    appVersion: Constants.expoConfig?.version || null,
    build: Constants.nativeBuildVersion ?? null,
    runtimeVersion: updates?.runtimeVersion || null,
    updateId: updates && !updates.isEmbeddedLaunch ? updates.updateId || null : null,
    os: Platform.OS,
    osVersion: device?.osVersion ?? (Platform.Version != null ? String(Platform.Version) : null),
    model: device?.modelName ?? null,
  };
}

/** A 64pt row in Settings' own row style (the caller's styles, so it
 *  cannot drift from the rows around it). */
export function FeedbackRow({ styles }: { styles: { section: object; navRow: object; navRowPressed: object; navText: object; label: object; value: object } }) {
  const colors = useColors();
  const toast = useToast();
  const send = useCallback(async () => {
    try {
      await Linking.openURL(feedbackMailto(feedbackInfo()));
      return;
    } catch {
      // No mail app to open: fall through to copying the address.
    }
    const clipboard = loadClipboard();
    let copied = false;
    if (clipboard) {
      try {
        copied = await clipboard.setStringAsync(FEEDBACK_EMAIL);
      } catch {
        copied = false;
      }
    }
    toast({
      message: copied
        ? `No mail app is set up. The address is copied: ${FEEDBACK_EMAIL}`
        : `No mail app is set up. Write to ${FEEDBACK_EMAIL}`,
      durationMs: 6000,
    });
  }, [toast]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send feedback"
      accessibilityHint="Opens an email to us with your app version filled in"
      onPress={send}
      style={({ pressed }) => [styles.section, styles.navRow, pressed && styles.navRowPressed]}
      testID="settings-feedback"
    >
      <View style={styles.navText}>
        <Text style={styles.label}>Send feedback</Text>
        <Text style={styles.value}>Opens an email to us</Text>
      </View>
      <Feather name="mail" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}
