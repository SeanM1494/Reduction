/**
 * components/settings/TimersCard.tsx — the timers toggle (the web's
 * NotificationSetting, ported).
 *
 * THE LIMITATION IS STATED WHETHER OR NOT IT IS SWITCHED ON, and before
 * someone relies on it rather than after they miss a timer: the server
 * sleeps when nobody is using it, so a timer that comes due long after the
 * app was closed does not fire until someone opens it again (ROADMAP, the
 * timers section — "even if the app is closed" was the first draft's
 * overselling, and the first burnt dinner would have been how someone
 * found out).
 *
 * The web's biggest case — "add it to your Home Screen first" — does not
 * exist here. In its place are the two ways a native build cannot hold a
 * token, each named plainly (lib/pushPolicy.ts).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetButton } from '@/components/Sheet';
import { useAuth } from '@/lib/auth-context';
import { disablePush, enablePush, pushState } from '@/lib/push';
import type { PushState } from '@/lib/pushPolicy';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export function TimersCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    pushState(userId)
      .then((s) => alive && setState(s))
      .catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, [userId]);

  const toggle = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      setState(state === 'on' ? await disablePush(userId) : await enablePush(userId));
    } catch (e) {
      setError((e as Error).message || 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }, [state, userId]);

  if (state === 'loading' || !userId) return null;

  const caveat = (
    <Text style={styles.caveat}>
      Alerts arrive while Reduction is open or has been used recently. The server sleeps when nobody's
      cooking, so a timer that finishes long after you closed the app waits until you come back. Always-on
      background alerts need a paid tier — they're planned, not built.
    </Text>
  );

  let body: React.ReactNode;
  if (state === 'unsupported') {
    body = (
      <Text style={styles.sub}>
        This device can't receive notifications. Timers still count down while the app is open.
      </Text>
    );
  } else if (state === 'needs-setup') {
    body = (
      <Text style={styles.sub}>
        Notifications aren't set up for this build yet. Timers still count down while the app is open.
      </Text>
    );
  } else if (state === 'denied') {
    body = (
      <>
        <Text style={styles.line}>Notifications are off for Reduction.</Text>
        <Text style={styles.sub}>
          Turn them back on in Settings › Notifications › Reduction. The app can't ask again.
        </Text>
      </>
    );
  } else {
    const on = state === 'on';
    body = (
      <>
        <Text style={styles.sub}>
          {on
            ? "You'll get a notification when a timer finishes, on every device you've turned this on for."
            : 'Get a notification when a timer finishes, on every device you turn this on for.'}
        </Text>
        <View style={styles.toggleRow}>
          <SheetButton
            label={busy ? 'One moment…' : on ? 'Turn off notifications' : 'Turn on notifications'}
            onPress={toggle}
            disabled={busy}
            testID="timers-toggle"
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {caveat}
      </>
    );
  }

  return (
    <View style={styles.card} testID={`timers-card-${state}`}>
      <Text style={styles.label}>Timers</Text>
      {body}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      paddingHorizontal: 18,
      gap: 6,
      ...cardShadow,
    },
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    line: { fontSize: 15, lineHeight: 21, color: colors.foreground, marginTop: 2 },
    sub: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground, marginTop: 2 },
    toggleRow: { flexDirection: 'row', marginTop: 8 },
    error: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
    // .rd-settings-caveat: the limitation, quieter but always present.
    caveat: { fontSize: 13, lineHeight: 18, color: colors.faint, marginTop: 6 },
  });
}
