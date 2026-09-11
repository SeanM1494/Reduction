/**
 * app/(tabs)/settings.tsx — account info, sign out, and a link to manage
 * billing on the website (see components/Paywall.tsx for why subscription
 * management stays on the web rather than in-app).
 */

import React from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export default function SettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user, entitlement, webUrl, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const confirmSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  const planLabel = entitlement?.subscribed
    ? 'Unlimited recipes'
    : entitlement?.reason === 'within_allowance'
      ? 'Free recipe available'
      : entitlement?.reason === 'exhausted'
        ? 'Free recipe used'
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
        {entitlement?.subscribed ? (
          // Only shown to an already-active subscriber managing an existing
          // plan — not a purchase CTA. Apple's guideline 3.1.1 targets
          // steering someone toward buying outside In-App Purchase; linking
          // an existing subscriber to manage what they already bought is a
          // different, permitted thing. This must never render for someone
          // without an active subscription — see components/Paywall.tsx for
          // why that screen has no link at all.
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(webUrl || 'https://recipereduction.com')}
          >
            <Text style={styles.link}>Manage your plan on the website</Text>
          </Pressable>
        ) : null}
      </View>

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
