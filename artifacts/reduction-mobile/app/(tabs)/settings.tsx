/**
 * app/(tabs)/settings.tsx — account, plan, timers, sign out.
 *
 * The Plan card sells and manages through the purchase seam
 * (lib/purchase.ts): an App Store subscription is managed in the App
 * Store's own page, a web one on the website, and only an existing
 * subscriber ever sees a link out (guideline 3.1.1 is about steering
 * someone toward buying elsewhere; managing what they already bought is
 * a different, permitted thing).
 */

import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { CouponBox } from '@/components/CouponBox';
import { TimersCard } from '@/components/settings/TimersCard';
import { SubscribeBox } from '@/components/SubscribeBox';
import { manageSubscription } from '@/lib/purchase';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export default function SettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user, entitlement, webUrl, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [manageError, setManageError] = useState<string | null>(null);

  const confirmSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  const remaining = entitlement ? Math.max(0, entitlement.allowance - entitlement.used) : 0;
  const planLabel = entitlement?.subscribed
    ? 'Unlimited recipes'
    : entitlement?.reason === 'within_allowance'
      ? remaining === 1
        ? 'Free recipe available'
        : `${remaining} free recipes available`
      : entitlement?.reason === 'exhausted'
        ? 'Free recipes used'
        : '—';

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: 84 + insets.bottom + 24 }]}>
      <View style={styles.section}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.value}>{user?.name || user?.email || 'Signed in'}</Text>
        {user?.email && user?.name ? <Text style={styles.subvalue}>{user.email}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Plan</Text>
        <Text style={styles.value}>{planLabel}</Text>
        {entitlement?.status === 'grace' ? (
          // Grace is the provider's own retry window, not a timer this app
          // runs, so the copy promises no number of days.
          <Text style={styles.subvalue}>
            Your last payment didn't go through. It will be retried, and nothing changes while it is.
          </Text>
        ) : null}
        {entitlement?.subscribed ? (
          entitlement.provider === 'apple' ? (
            // An App Store subscription is managed where it was bought.
            <Pressable
              style={styles.linkRow}
              onPress={async () => {
                setManageError(null);
                const out = await manageSubscription();
                if (out.status === 'error') setManageError(out.message);
              }}
              testID="settings-manage-apple"
            >
              <Text style={styles.link}>Manage your subscription</Text>
            </Pressable>
          ) : (
            // Only shown to an already-active subscriber managing an
            // existing plan — never to someone without one.
            <Pressable
              style={styles.linkRow}
              onPress={() => Linking.openURL(webUrl || 'https://recipereduction.com')}
            >
              <Text style={styles.link}>Manage your plan on the website</Text>
            </Pressable>
          )
        ) : (
          <>
            {/* Nothing on a host that cannot sell; the plans on one that can. */}
            <View style={styles.coupon}>
              <SubscribeBox />
            </View>
            {/* The second place a code can go (the first is the wall):
                someone given one last week comes here looking for it. */}
            <View style={styles.coupon}>
              <CouponBox />
            </View>
          </>
        )}
        {manageError ? <Text style={styles.error}>{manageError}</Text> : null}
      </View>

      <TimersCard />

      {/* .rd-btn-danger: a real button on the card colour, not a transparent
          box whose only edge is a line within a shade of the page. */}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutPressed]}
        onPress={confirmSignOut}
        testID="settings-sign-out"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 16 },
    // .rd-settings-card: card colour, hairline in `border`, 15px radius and
    // the card shadow — on parchment the shadow is what draws the edge.
    section: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      paddingHorizontal: 18,
      gap: 4,
      ...cardShadow,
    },
    // The meta label in the app's mono, tracked and faint — the same voice
    // as .rd-card-meta and .rd-lib-count, not the system sans.
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    value: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.foreground, marginTop: 2 },
    subvalue: { fontSize: 13, color: colors.mutedForeground },
    linkRow: { marginTop: 6, minHeight: 44, justifyContent: 'center' },
    coupon: { marginTop: 12 },
    error: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk, marginTop: 6 },
    link: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
    signOutButton: {
      minHeight: 48,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#3a2418',
      shadowOpacity: 0.07,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    signOutPressed: { borderColor: colors.borderStrong },
    signOutText: { color: colors.dangerInk, fontFamily: fonts.headingMedium, fontSize: 15 },
  });
}
