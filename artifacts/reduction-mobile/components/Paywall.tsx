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
  /** The one recipe they already have, if they have one. */
  recipeTitle?: string | null;
  /** A real way out: opens that recipe. A wall with no door reads as
   *  hostile; a wall with one reads as a limit (the web's rule 3). */
  onOpenRecipe?: () => void;
  /** Only changes the opening line, as on the web. */
  context?: 'search' | 'extract' | 'generic';
}

export function Paywall({ recipeTitle, onOpenRecipe, context = 'generic' }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [showCode, setShowCode] = useState(false);

  const lead =
    context === 'search'
      ? 'Searching for a new recipe needs a subscription.'
      : context === 'extract'
        ? 'Adding a new recipe needs a subscription.'
        : "You've used your free recipe.";

  return (
    <View style={styles.container} testID="paywall">
      <Text style={styles.title} testID="paywall-lead">
        {lead}
      </Text>

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
      {onOpenRecipe && recipeTitle ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecipe}
          style={({ pressed }) => [styles.door, pressed && styles.doorPressed]}
          testID="paywall-open-recipe"
        >
          <Text style={styles.doorText}>Open my recipe</Text>
        </Pressable>
      ) : null}
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
    // .rd-paywall-back: a plain .rd-btn, full width, under everything else.
    door: {
      alignSelf: 'stretch',
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      backgroundColor: colors.card,
      marginTop: 4,
    },
    doorPressed: { borderColor: colors.borderStrong },
    doorText: { fontSize: 14, color: colors.foreground, fontFamily: fonts.headingMedium },
  });
}
