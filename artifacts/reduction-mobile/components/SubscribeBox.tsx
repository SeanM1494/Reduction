/**
 * components/SubscribeBox.tsx — the plans and the Subscribe button, on
 * every host that can sell; nothing at all on one that cannot.
 *
 * Two mount points, like the coupon box: the wall, and the Plan card in
 * Settings. Neither knows who processes the purchase — they call the seam
 * in lib/purchase.ts — and neither renders a price it did not get from the
 * store, so a plan App Store Connect has not approved yet is simply
 * absent. "Restore purchases" is here because Apple expects it wherever
 * a subscription is sold, and because a new phone is the moment someone
 * needs it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SheetButton, SheetOption, optionRow } from '@/components/Sheet';
import { useAuth } from '@/lib/auth-context';
import { purchaseAvailable, purchaseOffers, restorePurchases, startPurchase, type Offer } from '@/lib/purchase';
import { PLAN_LABELS, type Plan } from '@/lib/purchasePolicy';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export function SubscribeBox() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user, refresh } = useAuth();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [plan, setPlan] = useState<Plan>('monthly');
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    purchaseAvailable()
      .then(async (can) => (can ? purchaseOffers() : []))
      .then((o) => alive && setOffers(o))
      .catch(() => alive && setOffers([]));
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(
    async (out: Awaited<ReturnType<typeof startPurchase>>, what: 'buy' | 'restore') => {
      if (out.status === 'completed') {
        await refresh();
        setMessage({ ok: true, text: what === 'buy' ? 'Subscribed. Unlimited recipes are on.' : 'Your subscription is back on this account.' });
      } else if (out.status === 'started') {
        setMessage({ ok: true, text: 'Waiting on the App Store. Your recipes unlock as soon as it confirms.' });
      } else if (out.status === 'error') {
        setMessage({ ok: false, text: out.message });
      } else if (out.status === 'unavailable') {
        setMessage({ ok: false, text: 'Purchases are not available on this device.' });
      }
      // cancelled: nothing to say — the person said no.
      setBusy(null);
    },
    [refresh]
  );

  const buy = useCallback(async () => {
    if (!user || busy) return;
    setBusy('buy');
    setMessage(null);
    await finish(await startPurchase(plan, user.id), 'buy');
  }, [user, busy, plan, finish]);

  const restore = useCallback(async () => {
    if (!user || busy) return;
    setBusy('restore');
    setMessage(null);
    await finish(await restorePurchases(user.id), 'restore');
  }, [user, busy, finish]);

  if (!offers || offers.length === 0 || !user) return null;
  const chosen = offers.find((o) => o.plan === plan) ?? offers[0];

  return (
    <View style={styles.box} testID="subscribe-box">
      <Text style={styles.label}>Unlimited recipes</Text>
      <View style={optionRow}>
        {offers.map((o) => (
          <SheetOption
            key={o.plan}
            label={`${PLAN_LABELS[o.plan].name} · ${o.price}/${PLAN_LABELS[o.plan].per}`}
            current={o.plan === chosen.plan}
            disabled={!!busy}
            onPress={() => setPlan(o.plan)}
          />
        ))}
      </View>
      <View style={styles.row}>
        <SheetButton label={busy === 'buy' ? 'One moment…' : `Subscribe — ${chosen.price}/${PLAN_LABELS[chosen.plan].per}`} onPress={buy} disabled={!!busy} testID="subscribe-buy" />
      </View>
      <Pressable accessibilityRole="button" onPress={restore} disabled={!!busy} style={styles.restore} testID="subscribe-restore">
        <Text style={styles.restoreText}>{busy === 'restore' ? 'Checking the App Store…' : 'Restore purchases'}</Text>
      </Pressable>
      {message ? (
        <Text style={[styles.message, { color: message.ok ? colors.coolInk : colors.dangerInk }]} accessibilityLiveRegion="polite" testID="subscribe-message">
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    box: { gap: 10, alignSelf: 'stretch' },
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    row: { flexDirection: 'row' },
    restore: { minHeight: 44, justifyContent: 'center' },
    restoreText: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
    message: { fontSize: 13.5, lineHeight: 19 },
  });
}
