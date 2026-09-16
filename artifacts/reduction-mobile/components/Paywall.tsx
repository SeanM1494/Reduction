/**
 * components/Paywall.tsx — shown when the entitlement check says no.
 *
 * It sells ONLY through the purchase seam (lib/purchase.ts), which is In-App
 * Purchase on an iPhone and nothing anywhere else. It never links to the
 * website to pay: Apple's guideline 3.1.1 forbids steering someone toward
 * buying a digital subscription outside In-App Purchase, and a "Subscribe
 * on the website" button (what this component once rendered) is exactly
 * that steering. On a host with no handler — the web build, a simulator —
 * the SubscribeBox renders nothing and the wall only states the limit. A
 * user who subscribed on the web still unlocks here automatically through
 * the shared entitlement check (auth-context.tsx); that is not a purchase
 * flow, just recognising an existing one.
 *
 * What it DOES offer is a code (components/CouponBox.tsx): "N recipes free"
 * is a grant, not a sale, and the wall is the moment someone holding one
 * wants it. Behind a "Have a code?" link, as on the web, so the wall does
 * not read as a form to everyone without one.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CouponBox } from '@/components/CouponBox';
import { SubscribeBox } from '@/components/SubscribeBox';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

interface Props {
  recipeTitle?: string | null;
  context?: 'search' | 'extract' | 'generic';
}

export function Paywall({ recipeTitle, context = 'generic' }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [showCode, setShowCode] = useState(false);

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

      <SubscribeBox />

      {showCode ? (
        <CouponBox onRedeemed={() => setShowCode(false)} />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowCode(true)}
          style={styles.codeLink}
          testID="paywall-have-code"
        >
          <Text style={styles.codeLinkText}>Have a code?</Text>
        </Pressable>
      )}
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
    // .rd-paywall-link: a quiet text link, 44px tall so it is a real target.
    codeLink: { minHeight: 44, justifyContent: 'center' },
    codeLinkText: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
  });
}
