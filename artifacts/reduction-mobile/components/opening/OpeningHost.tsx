/**
 * components/opening/OpeningHost.tsx — whether the opening sequence plays,
 * and the native splash's hand-off to it.
 *
 * Mounted once at the root, above the app (app/_layout.tsx), which boots
 * underneath as normal. It owns the native splash's exit: the splash stays
 * up until this launch is decided (lib/opening/launch.ts, capped at 400ms
 * once the app is active), then either hides at once (no sequence) or
 * hides on the sequence's first frame, which is the same color.
 *
 * Settings' "Replay intro" and the testing sheet play it here too, over
 * whatever screen is open, touching no stamps.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Appearance, Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import type { Version } from '@/lib/opening/cadence';
import { launchInfo, markShown, onAppReady, onReplay, recordRun, type ReplayKind } from '@/lib/opening/launch';
import { OpeningOverlay } from './OpeningOverlay';

interface Run {
  id: number;
  kind: ReplayKind;
  /** What a launch counts as; null for a replay. */
  version: Version | null;
  darkStart: boolean;
  frozenT?: number;
}

/** Web, development only: `?opening=full|quick|static` plays that version
 *  regardless of the stamps, `&t=2.4` freezes it on that frame, `&ready=0`
 *  keeps the app "not ready" (the hold), `&dark=1` opens from the dark
 *  splash color. For screenshots in Chromium; never in a build. */
function devRequest(): (Run & { ready: boolean }) | null {
  if (Platform.OS !== 'web' || !__DEV__ || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const kind = q.get('opening');
  if (kind !== 'full' && kind !== 'quick' && kind !== 'static') return null;
  const t = q.get('t');
  return { id: 1, kind, version: null, darkStart: q.get('dark') === '1', frozenT: t === null ? undefined : Number(t), ready: q.get('ready') !== '0' };
}

export function OpeningHost() {
  const [run, setRun] = useState<Run | null>(null);
  const ready = useSharedValue(false);
  const splashDone = useRef(false);
  // `&ready=0` in development: the app never counts as ready.
  const devHold = useRef(false);

  const hideSplash = useCallback(() => {
    if (splashDone.current) return;
    splashDone.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const dev = devRequest();
    if (dev) {
      devHold.current = !dev.ready;
      ready.value = dev.ready;
      setRun(dev);
      hideSplash();
      return;
    }
    let cancelled = false;
    launchInfo().then((info) => {
      if (cancelled) return;
      const { play, version } = info.decision;
      if (play === 'none' || !version) return hideSplash();
      setRun({ id: 1, kind: play === 'static' ? 'static' : version, version, darkStart: info.darkStart });
      // If the first frame never comes, the app must not wait behind the
      // splash for it.
      setTimeout(hideSplash, 1000);
    });
    return () => {
      cancelled = true;
    };
  }, [hideSplash, ready]);

  useEffect(
    () =>
      onAppReady(() => {
        if (!devHold.current) ready.value = true;
      }),
    [ready]
  );

  useEffect(
    () =>
      onReplay((kind) => {
        ready.value = true;
        setRun({ id: Date.now(), kind, version: null, darkStart: Appearance.getColorScheme() === 'dark' });
      }),
    [ready]
  );

  if (!run) return null;
  return (
    <OpeningOverlay
      key={run.id}
      kind={run.kind}
      darkStart={run.darkStart}
      ready={ready}
      frozenT={run.frozenT}
      onShown={hideSplash}
      onStarted={() => {
        if (run.version) void markShown(run.version);
      }}
      onEnded={(stats) => {
        recordRun(stats, run.kind);
        setRun(null);
      }}
    />
  );
}
