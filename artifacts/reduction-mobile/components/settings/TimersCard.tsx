/**
 * components/settings/TimersCard.tsx — the timers toggle.
 *
 * SINCE OCT 5 THE PHONE RINGS ITSELF. An alert is scheduled on the device
 * the moment a timer starts (lib/timerAlerts.ts), so it is delivered with
 * the app closed and the server asleep — which the server's push never
 * could be. What it cannot do is hear about a timer started on another
 * device until this one has loaded the library since, and the card says
 * that rather than promising more (the first draft of the web's card said
 * "even if the app is closed" when it was not true; now it is, here, and
 * the remaining limit is stated just as plainly).
 *
 * On iOS 26+ (binaries from 1.3.0) the card also offers "Ring like an
 * alarm": AlarmKit, which rings through Silent mode — the one thing a
 * notification cannot do in a kitchen. It is offered, never switched on by
 * itself, because it asks its own permission.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetButton } from '@/components/Sheet';
import { disableTimerAlerts, enableTimerAlarms, enableTimerAlerts, timerAlertCard } from '@/lib/timerAlerts';
import type { AlertState } from '@/lib/timerAlertPolicy';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export function TimersCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [state, setState] = useState<AlertState | 'loading'>('loading');
  // iOS 26+ on a binary with the AlarmKit module, and not refused.
  const [alarms, setAlarms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    timerAlertCard()
      .then((c) => {
        if (!alive) return;
        setState(c.state);
        setAlarms(c.alarms);
      })
      .catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async (change: () => Promise<AlertState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await change());
      const c = await timerAlertCard();
      setAlarms(c.alarms);
    } catch (e) {
      setError((e as Error).message || 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (state === 'loading') return null;

  const caveat = (
    <Text style={styles.caveat}>
      Alerts come from this phone, so they ring even with Reduction closed. A timer started on another
      device rings here only after you've opened Reduction on this phone.
      {state === 'alarm' ? '' : ' With the ringer off, notifications are silent.'}
    </Text>
  );

  const alarmButton = alarms ? (
    <SheetButton
      label={busy ? 'One moment…' : 'Ring like an alarm'}
      onPress={() => run(enableTimerAlarms)}
      disabled={busy}
      testID="timers-alarm"
    />
  ) : null;

  let body: React.ReactNode;
  if (state === 'unsupported') {
    body = (
      <Text style={styles.sub}>
        This device can't receive notifications. Timers still count down while the app is open.
      </Text>
    );
  } else if (state === 'alarm') {
    body = (
      <>
        <Text style={styles.sub}>
          Timers ring like an alarm on this phone, even on silent, with a Done button to stop them.
        </Text>
        <View style={styles.toggleRow}>
          <SheetButton
            label={busy ? 'One moment…' : 'Use notifications instead'}
            onPress={() => run(enableTimerAlerts)}
            disabled={busy}
            testID="timers-notifications"
          />
          <SheetButton label="Turn off" onPress={() => run(disableTimerAlerts)} disabled={busy} testID="timers-toggle" />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {caveat}
      </>
    );
  } else if (state === 'denied') {
    body = (
      <>
        <Text style={styles.line}>Notifications are off for Reduction.</Text>
        <Text style={styles.sub}>
          Turn them back on in Settings › Notifications › Reduction. The app can't ask again.
        </Text>
        {alarmButton ? <View style={styles.toggleRow}>{alarmButton}</View> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </>
    );
  } else {
    const on = state === 'on';
    body = (
      <>
        <Text style={styles.sub}>
          {on
            ? "You'll get a notification on this phone when a timer finishes."
            : 'Get a notification on this phone when a timer finishes.'}
        </Text>
        <View style={styles.toggleRow}>
          <SheetButton
            label={busy ? 'One moment…' : on ? 'Turn off notifications' : 'Turn on notifications'}
            onPress={() => run(on ? disableTimerAlerts : enableTimerAlerts)}
            disabled={busy}
            testID="timers-toggle"
          />
          {alarmButton}
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
    toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    error: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
    // .rd-settings-caveat: the limitation, quieter but always present.
    caveat: { fontSize: 13, lineHeight: 18, color: colors.faint, marginTop: 6 },
  });
}
