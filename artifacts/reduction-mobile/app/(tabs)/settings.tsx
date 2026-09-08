/**
 * app/(tabs)/settings.tsx — account info, sign out, and a link to manage
 * billing on the website (see components/Paywall.tsx for why subscription
 * management stays on the web rather than in-app).
 */

import React from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function SettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user, entitlement, webUrl, signOut } = useAuth();

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      <Pressable style={styles.signOutButton} onPress={confirmSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 24 },
    section: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 4,
    },
    label: { fontSize: 12, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
    value: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.foreground, marginTop: 2 },
    subvalue: { fontSize: 13, color: colors.mutedForeground },
    linkRow: { marginTop: 10 },
    link: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium },
    signOutButton: {
      borderWidth: 1,
      borderColor: colors.dangerLine,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
    },
    signOutText: { color: colors.dangerInk, fontFamily: fonts.headingMedium, fontSize: 15 },
  });
}
