/**
 * components/opening/IntroTestingSheet.tsx — the owner's tools for the
 * opening sequence, on a production build where development-only code
 * never runs. Reached by a long press on Settings' "Replay intro", and
 * only for the allowlisted account (lib/opening/owner.ts) — hidden from
 * review and from users, not a security boundary.
 *
 * Play any version (no stamps), reset either stamp so the next cold start
 * plays by the real rules, see what is stored, and read the frame rate of
 * the last run — the 55fps kill criterion as a number on the phone.
 *
 * Above all that, which code this launch is running (Oct 1): the
 * over-the-air update or the binary's own bundle, its channel and runtime,
 * the last check and any error — components/settings/UpdateStatus.tsx —
 * and the switch between the production and preview update channels
 * (components/settings/ChannelSwitch.tsx).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet, SheetButton } from '@/components/Sheet';
import { lastRunStats, readStamps, requestReplay, resetStamps, type ReplayKind } from '@/lib/opening/launch';
import { OPENING_ENABLED } from '@/lib/opening/config';
import { useColors, type Colors } from '@/hooks/useColors';
import { UpdateStatus } from '@/components/settings/UpdateStatus';
import { ChannelSwitch } from '@/components/settings/ChannelSwitch';

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
};

export function IntroTestingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [stored, setStored] = useState<string>('…');
  const [queued, setQueued] = useState<ReplayKind | null>(null);
  // Read when the sheet opens, into state: a module value read during
  // render is exactly what the React Compiler memoizes into a constant.
  const [run, setRun] = useState(lastRunStats);

  const reload = () =>
    readStamps().then((s) => {
      const last = s.lastShownAt === null ? 'never' : s.lastShownAt > Date.now() ? 'in the future (clock moved back)' : ago(Date.now() - s.lastShownAt);
      setStored(`First launch played: ${s.fullShown ? 'yes' : 'no'}\nLast played: ${last}`);
    });
  useEffect(() => {
    if (!open) return;
    setRun(lastRunStats());
    void reload();
  }, [open]);

  // Played after the sheet has gone: a Modal draws above the overlay.
  const play = (kind: ReplayKind) => {
    setQueued(kind);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Intro testing"
      onClose={onClose}
      onClosed={() => {
        if (queued) requestReplay(queued);
        setQueued(null);
      }}
    >
      <Text style={styles.heading}>This launch</Text>
      <UpdateStatus />
      <ChannelSwitch />
      <Text style={styles.heading}>The intro</Text>
      <Text style={styles.text} testID="intro-testing-stored">
        {stored}
        {OPENING_ENABLED ? '' : '\nThe intro is switched OFF (OPENING_ENABLED).'}
      </Text>
      <Text style={styles.text} testID="intro-testing-fps">
        {run
          ? `Last run (${run.kind}): ${run.avgFps} fps average, ${run.worstFps} fps worst frame, ${run.slow} of ${run.frames} frames under 55 fps, ${run.seconds}s`
          : 'No run yet in this session.'}
      </Text>
      <View style={styles.buttons}>
        <SheetButton label="Play Full" onPress={() => play('full')} testID="intro-play-full" />
        <SheetButton label="Play Quick" onPress={() => play('quick')} testID="intro-play-quick" />
        <SheetButton label="Play the still (Reduce Motion)" onPress={() => play('static')} testID="intro-play-static" />
        <SheetButton
          label="Reset first launch"
          onPress={() => void resetStamps('full').then(reload)}
          testID="intro-reset-full"
        />
        <SheetButton
          label="Reset the 24-hour timer"
          onPress={() => void resetStamps('last').then(reload)}
          testID="intro-reset-last"
        />
      </View>
      <Text style={styles.hint}>
        A reset takes effect on the next cold start: swipe the app away in the app switcher, then open it.
      </Text>
    </Sheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    heading: { fontSize: 13, fontWeight: '600', color: colors.mutedForeground, marginBottom: 6 },
    text: { fontSize: 15, lineHeight: 21, color: colors.foreground, marginBottom: 10 },
    buttons: { gap: 8, marginTop: 4 },
    hint: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground, marginTop: 12 },
  });
}
