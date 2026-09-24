/**
 * components/LegalLinks.tsx — the Terms of Use and Privacy Policy links,
 * as Apple requires wherever a subscription is offered (guideline 3.1.2)
 * and as any account screen owes people. Opens the website's pages in
 * the browser (lib/legal.ts says where). `terms` adds the renewal sentence
 * beside a price. Each link is a 44px row.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { legalUrl, RENEWAL_TERMS } from '@/lib/legal';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

interface Props {
  terms?: boolean;
  /** Centre the row and the renewal line (the sign-in screen, the wall);
   *  default is start-aligned. */
  center?: boolean;
}

export function LegalLinks({ terms = false, center = false }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { webUrl } = useAuth();
  const open = (page: 'terms' | 'privacy') => Linking.openURL(legalUrl(webUrl, page)).catch(() => {});
  return (
    <View testID="legal-links">
      {terms ? <Text style={[styles.terms, center && styles.centerText]}>{RENEWAL_TERMS}</Text> : null}
      <View style={[styles.row, center && styles.center]}>
        <Pressable accessibilityRole="link" onPress={() => open('terms')} style={styles.link} testID="legal-terms">
          <Text style={styles.linkText}>Terms of Use</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => open('privacy')} style={styles.link} testID="legal-privacy">
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    terms: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground },
    row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
    center: { justifyContent: 'center' },
    centerText: { textAlign: 'center' },
    link: { minHeight: 44, justifyContent: 'center' },
    linkText: { fontSize: 14, color: colors.mutedForeground, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
  });
}
