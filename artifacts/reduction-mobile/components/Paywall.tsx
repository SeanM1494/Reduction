/**
 * components/Paywall.tsx — shown when the entitlement check says no.
 *
 * Deliberately has NO purchase call-to-action, unlike the web version
 * (client/src/components/Paywall.tsx). Apple's guideline 3.1.1 forbids
 * steering a user toward buying a digital subscription outside In-App
 * Purchase — a "Subscribe on the website" button (what this component used
 * to render) is exactly that steering and would put the whole app at App
 * Review risk. Until native in-app purchase ships (tracked as a follow-up:
 * "Let mobile users subscribe without leaving the app"), this screen only
 * states the limit was reached; it does not mention price or link anywhere
 * to pay. A user who already subscribed on the web still unlocks mobile
 * automatically via the shared entitlement check (see auth-context.tsx) —
 * that is not a purchase flow, just recognizing an existing one.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

interface Props {
  recipeTitle?: string | null;
  context?: 'search' | 'extract' | 'generic';
}

export function Paywall({ recipeTitle, context = 'generic' }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const lead =
    context === 'search'
      ? "You've used your free recipe."
      : context === 'extract'
        ? "You've used your free recipe."
        : "You've used your free recipe.";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{lead}</Text>

      {recipeTitle ? (
        <Text style={styles.keep}>
          <Text style={styles.keepStrong}>{recipeTitle}</Text> is yours to keep — cook it, scale
          it, any time.
        </Text>
      ) : null}

      <Text style={styles.fineprint}>
        Adding more recipes needs the paid plan. If you already have one on your account, it will
        unlock here automatically.
      </Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // A card that has to carry itself: the web's .rd-paywall-offer radius
    // and the card shadow, so it does not float as a borderless block.
    container: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 22,
      paddingHorizontal: 20,
      gap: 12,
      alignItems: 'center',
      ...cardShadow,
    },
    // .rd-paywall-title: 20px; .rd-paywall-keep: 15px on muted.
    title: {
      fontFamily: fonts.heading,
      fontSize: 20,
      lineHeight: 26,
      color: colors.foreground,
      textAlign: 'center',
    },
    keep: { fontSize: 15, lineHeight: 22, color: colors.mutedForeground, textAlign: 'center' },
    keepStrong: { color: colors.foreground, fontFamily: fonts.headingMedium },
    fineprint: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground, textAlign: 'center' },
  });
}
