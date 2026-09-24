/**
 * components/CouponBox.tsx — redeeming an "N recipes free" code.
 *
 * IN BOTH PLACES, DELIBERATELY (the web's CouponBox, ported). At the wall,
 * because that is the moment of intent — someone holding a code is holding
 * it for exactly this instant. And in Settings, because that is where a
 * person who was given a code last week goes looking for it. One
 * component, one endpoint, two mount points.
 *
 * This is only the RECIPES mechanic: a usage grant that adds to the same
 * allowance the free tier runs on. A "free months" code is a billing
 * discount and lives with the payment provider, never here — see
 * api-server/src/lib/billing/coupons.ts for why one system for both makes
 * both worse. Redeeming one is not a purchase and steers nobody toward
 * buying anything, so it is fine on an App Store build (guideline 3.1.1
 * is about selling, and this sells nothing).
 *
 * On success the account's entitlement is refreshed here rather than by
 * each mount point: an allowance is a fact about the account, and the wall
 * lifts because the entitlement moved, not because the box said so.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SheetButton } from '@/components/Sheet';
import { redeemCoupon } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

interface Props {
  onRedeemed?: (recipes: number) => void;
}

export function CouponBox({ onRedeemed }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const out = await redeemCoupon(trimmed);
      const n = out.recipes ?? 0;
      setMessage({ ok: true, text: `Added ${n} ${n === 1 ? 'recipe' : 'recipes'} to your account.` });
      setCode('');
      await refresh();
      onRedeemed?.(n);
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message || 'Could not redeem that code.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID="coupon-box">
      <Text style={styles.label}>Redeem a code</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="MEG10"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel="Code"
          testID="coupon-input"
        />
        <SheetButton label={busy ? '…' : 'Redeem'} onPress={submit} disabled={busy || !code.trim()} testID="coupon-redeem" />
      </View>
      {message ? (
        <Text
          style={[styles.message, { color: message.ok ? colors.coolInk : colors.dangerInk }]}
          accessibilityLiveRegion="polite"
          testID="coupon-message"
        >
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    box: { gap: 8, alignSelf: 'stretch' },
    // .rd-coupon-label: the same meta voice as the settings labels.
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    input: {
      flex: 1,
      // Lets the field give way to the Redeem button. Yoga never holds a
      // text input at its intrinsic width, but a browser does (min-width:
      // auto), and on a 320pt screen that pushed Redeem off the card in the
      // web build. Harmless on native.
      minWidth: 0,
      minHeight: 44,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      // 16px is the input floor (the house rule; see the Find tab).
      fontSize: 16,
      fontFamily: fonts.mono,
      letterSpacing: 0.5,
      color: colors.foreground,
    },
    message: { fontSize: 13.5, lineHeight: 19 },
  });
}
