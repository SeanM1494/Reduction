/**
 * components/SubscribeBox.tsx — the plans, each one a purchase button, on
 * every host that can sell; nothing at all on one that cannot.
 *
 * Tapping a plan starts that purchase immediately: the store's own sheet
 * is the confirmation, so a second "Subscribe" step here would only be a
 * tap between the person and the price they just chose. Two mount points,
 * like the coupon box: the wall, and the Plan card in Settings. Neither
 * knows who processes the purchase — they call the seam in
 * lib/purchase.ts — and neither renders a price it did not get from the
 * store, so a plan App Store Connect has not approved yet is simply
 * absent. "Restore purchases" is here because Apple expects it wherever a
 * subscription is sold, and because a new phone is the moment someone
 * needs it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SheetButton, optionRow } from '@/components/Sheet';
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
  /** The plan being bought, or 'restore', while the store has the floor. */
  const [busy, setBusy] = useState<Plan | 'restore' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    purchaseAvailable()
      .then(async (can) => (can ? purchaseOffers() : []))
      .then((o) => alive && setOffers(o))
      .catch((e) => {
        // Swallowed for the user (the box just renders nothing), said aloud
        // for whoever is holding a dev build; lib/storeKit.ts has already
        // logged the store's own answer by the time this fires.
        if (__DEV__) console.log('[subscribe] offers unavailable:', (e as Error)?.message ?? e);
        if (alive) setOffers([]);
      });
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

  const buy = useCallback(
    async (plan: Plan) => {
      if (!user || busy) return;
      setBusy(plan);
      setMessage(null);
      await finish(await startPurchase(plan, user.id), 'buy');
    },
    [user, busy, finish]
  );

  const restore = useCallback(async () => {
    if (!user || busy) return;
    setBusy('restore');
    setMessage(null);
    await finish(await restorePurchases(user.id), 'restore');
  }, [user, busy, finish]);

  if (!offers || offers.length === 0 || !user) return null;

  return (
    <View style={styles.box} testID="subscribe-box">
      <Text style={styles.label}>Unlimited recipes</Text>
      <View style={optionRow}>
        {offers.map((o) => (
          <SheetButton
            key={o.plan}
            label={busy === o.plan ? 'One moment…' : `${PLAN_LABELS[o.plan].name} · ${o.price}/${PLAN_LABELS[o.plan].per}`}
            onPress={() => buy(o.plan)}
            disabled={!!busy}
            testID={`subscribe-${o.plan}`}
          />
        ))}
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
    restore: { minHeight: 44, justifyContent: 'center' },
    restoreText: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
    message: { fontSize: 13.5, lineHeight: 19 },
  });
}
