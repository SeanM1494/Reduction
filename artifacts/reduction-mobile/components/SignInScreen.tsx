/**
 * components/SignInScreen.tsx — the account path, reached from the demo.
 *
 * The demo is the first screen (see DemoScreen); this is where its "Sign in"
 * leads, and the way back is one tap. See lib/auth-context.tsx for why
 * mobile has no anonymous mode.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';
import { BrandLogo } from '@/components/BrandLogo';

export function SignInScreen({ onBack }: { onBack: () => void }) {
  const { signIn, signingIn, signInError } = useAuth();
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <BrandLogo size={64} />
          <Text style={styles.wordmark}>Reduction</Text>
          <Text style={styles.tagline}>Recipes, boiled down to what matters.</Text>
        </View>

        <Pressable style={styles.demoInvite} onPress={onBack} accessibilityRole="button" testID="signin-back">
          <Text style={styles.demoInviteArrow}>&larr;</Text>
          <Text style={styles.demoInviteText}>Back to the guacamole demo</Text>
        </Pressable>

        <View style={styles.buttons}>
          <Pressable
            style={[styles.button, styles.primaryButton]}
            disabled={!!signingIn}
            onPress={() => signIn('google')}
          >
            {signingIn === 'google' ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Google</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.button, styles.secondaryButton]}
            disabled={!!signingIn}
            onPress={() => signIn('apple')}
          >
            {signingIn === 'apple' ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={styles.secondaryButtonText}>Continue with Apple</Text>
            )}
          </Pressable>
        </View>

        {signInError ? <Text style={styles.error}>{signInError}</Text> : null}

        <Text style={styles.fineprint}>
          Your first recipe is free. One account works on the web and here.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 28,
      gap: 40,
    },
    brand: { alignItems: 'center', gap: 8 },
    wordmark: {
      fontFamily: fonts.headingBold,
      fontSize: 34,
      color: colors.foreground,
    },
    tagline: {
      fontSize: 15,
      color: colors.mutedForeground,
      textAlign: 'center',
    },
    demoInvite: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radiusCard,
      ...cardShadow,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    demoInviteText: {
      flex: 1,
      color: colors.foreground,
      fontFamily: fonts.headingMedium,
      fontSize: 15,
    },
    demoInviteArrow: {
      color: colors.foreground,
      fontSize: 16,
      marginRight: 10,
    },
    buttons: { gap: 12 },
    button: {
      height: 52,
      borderRadius: colors.radiusButton,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: { backgroundColor: colors.primary },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontFamily: fonts.headingMedium,
      fontSize: 16,
    },
    secondaryButton: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    secondaryButtonText: {
      color: colors.foreground,
      fontFamily: fonts.headingMedium,
      fontSize: 16,
    },
    error: {
      color: colors.dangerInk,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      padding: 12,
      borderRadius: 9,
      textAlign: 'center',
      fontSize: 13.5,
      lineHeight: 19,
    },
    fineprint: {
      textAlign: 'center',
      color: colors.faint,
      fontSize: 12,
    },
  });
}
