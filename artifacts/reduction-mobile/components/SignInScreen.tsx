/**
 * components/SignInScreen.tsx — the account path, reached from the demo.
 *
 * The demo is the first screen (see DemoScreen); this is where its "Sign in"
 * leads, and the way back is one tap. See lib/auth-context.tsx for why
 * mobile has no anonymous mode.
 *
 * ONLY PROVIDERS THE SERVER REPORTS AS CONFIGURED ARE OFFERED — the web's
 * rule (SignIn.tsx), because a sign-in button that 503s on tap is worse
 * than one that isn't there. Google is hidden when unconfigured; Apple is
 * rendered disabled with "Coming soon", present rather than hidden, so
 * someone who only signs in with Apple sees it is coming rather than
 * concluding this app will never support them; and when neither is
 * configured the screen says so. Until the server has answered (or when it
 * could not be asked) both are offered, enabled: hiding sign-in over a
 * flaky connection at boot would strand someone who can sign in a moment
 * later. The rule is `offerFrom` in lib/authErrors.ts, under test.
 *
 * A failed handshake shows the server's own reason in the web's sentence
 * for it ("expired" and "declined" are different advice), not one line for
 * everything — lib/authErrors.ts again.
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { offerFrom } from '@/lib/authErrors';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';
import { BrandLogo } from '@/components/BrandLogo';
import { LegalLinks } from '@/components/LegalLinks';

export function SignInScreen({ onBack }: { onBack: () => void }) {
  const { signIn, signingIn, signInError, providers, reloadProviders } = useAuth();
  const colors = useColors();
  const styles = makeStyles(colors);
  const offer = offerFrom(providers);

  // Still unknown from boot (no network then, or a slow answer): ask again
  // now that someone is actually looking at the buttons.
  useEffect(() => {
    if (providers === null) void reloadProviders();
  }, [providers, reloadProviders]);

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

        <View style={styles.buttons} testID={`signin-providers-${providers === null ? 'unknown' : 'known'}`}>
          {offer.google ? (
            <Pressable
              style={[styles.button, styles.primaryButton]}
              disabled={!!signingIn}
              onPress={() => signIn('google')}
              accessibilityRole="button"
              testID="signin-google"
            >
              {signingIn === 'google' ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>Continue with Google</Text>
              )}
            </Pressable>
          ) : null}
          {offer.apple === 'enabled' ? (
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              disabled={!!signingIn}
              onPress={() => signIn('apple')}
              accessibilityRole="button"
              testID="signin-apple"
            >
              {signingIn === 'apple' ? (
                <ActivityIndicator color={colors.foreground} />
              ) : (
                <Text style={styles.secondaryButtonText}>Continue with Apple</Text>
              )}
            </Pressable>
          ) : (
            // Present rather than hidden, disabled because a button that
            // 503s is worse than no button (the web's .rd-provider.is-soon).
            <View
              style={[styles.button, styles.secondaryButton, styles.soonButton]}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              aria-disabled
              accessibilityLabel="Continue with Apple, coming soon"
              testID="signin-apple-soon"
            >
              <Text style={[styles.secondaryButtonText, styles.soonText]}>Continue with Apple</Text>
              <Text style={styles.soonTag}>Coming soon</Text>
            </View>
          )}
        </View>

        {signInError ? (
          <Text style={styles.error} accessibilityRole="alert" testID="signin-error">
            {signInError}
          </Text>
        ) : null}

        {offer.noneConfigured ? (
          <Text style={styles.hint} testID="signin-none">
            Sign-in isn&rsquo;t configured on this server yet &mdash; the demo works without an account in the
            meantime.
          </Text>
        ) : null}

        <Text style={styles.fineprint}>
          Your first recipe is free. One account works on the web and here.
        </Text>
        <LegalLinks center />
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
    // .rd-provider.is-soon: the same button at half strength, with the tag
    // where the web puts it, so the row reads as "not yet" rather than
    // "broken".
    soonButton: { flexDirection: 'row', gap: 10, opacity: 0.6, borderStyle: 'dashed' },
    soonText: { color: colors.mutedForeground },
    soonTag: {
      fontFamily: fonts.mono,
      fontSize: 10.5,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: colors.mutedForeground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 99,
      paddingHorizontal: 8,
      paddingVertical: 3,
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
    hint: {
      textAlign: 'center',
      color: colors.mutedForeground,
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
