/**
 * components/settings/RateRow.tsx — Settings › Rate Reduction: opens the
 * App Store's review page, for the person who goes looking (lib/rating.ts
 * says why this and Apple's own prompt are the only two ways to ask).
 *
 * iOS only, and absent until APP_STORE_ID is filled in: the review page
 * does not exist before the app is live. Plain Linking, no native module,
 * so it rides an over-the-air update.
 */

import React, { useCallback } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { writeReviewUrl } from '@/lib/rating';

export function RateRow({ styles }: { styles: { section: object; navRow: object; navRowPressed: object; navText: object; label: object; value: object } }) {
  const colors = useColors();
  const url = Platform.OS === 'ios' ? writeReviewUrl() : null;
  const open = useCallback(() => {
    if (url) Linking.openURL(url).catch(() => {});
  }, [url]);
  if (!url) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Rate Reduction"
      accessibilityHint="Opens the App Store to leave a rating"
      onPress={open}
      style={({ pressed }) => [styles.section, styles.navRow, pressed && styles.navRowPressed]}
      testID="settings-rate"
    >
      <View style={styles.navText}>
        <Text style={styles.label}>Rate Reduction</Text>
        <Text style={styles.value}>Leave a rating on the App Store</Text>
      </View>
      <Feather name="star" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}
