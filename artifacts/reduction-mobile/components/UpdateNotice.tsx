/**
 * components/UpdateNotice.tsx — build 7's last word: "a new version is in
 * TestFlight". Lives ONLY on the `claude/project-thread-210qfm` branch, cut from the last
 * commit at expo.version 1.1.0 (b16e9a7), and reaches phones only as an over-the-air
 * update for runtime 1.1.0. Build 8 (1.2.0) never runs this code: an update
 * reaches exactly the builds whose runtime matches, and main does not carry
 * this file.
 *
 * Shown once the opening sequence has finished and the app has something
 * to show, so it never lands over the intro. "Not now" hides it for this
 * launch; "Open TestFlight" hides it for good on this phone (the update
 * itself is TestFlight's to make). Signed in or out alike: a tester on
 * the demo screen needs the new build just as much.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Window } from '@/components/Window';
import { onAppReady } from '@/lib/opening/launch';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const KEY = 'reduction_build8_notice_opened';
/** TestFlight's own URL scheme: opens the app on its list of builds. */
const TESTFLIGHT_URL = 'itms-beta://';
const TESTFLIGHT_STORE_URL = 'https://apps.apple.com/app/testflight/id899247664';

export function UpdateNotice({ openingDone }: { openingDone: boolean }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [ready, setReady] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => onAppReady(() => setReady(true)), []);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((v) => live && setWanted(v === null))
      .catch(() => live && setWanted(true));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!(ready && openingDone && wanted)) return;
    // A beat after the reveal, so the screen underneath is seen first.
    // Once per launch: a replayed intro does not bring it back.
    const t = setTimeout(() => {
      setWanted(false);
      setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [ready, openingDone, wanted]);

  const openTestFlight = () => {
    AsyncStorage.setItem(KEY, '1').catch(() => {});
    setOpen(false);
    Linking.openURL(TESTFLIGHT_URL).catch(() => Linking.openURL(TESTFLIGHT_STORE_URL).catch(() => {}));
  };

  return (
    <Window open={open} onClose={() => setOpen(false)} maxWidth={400} testID="update-notice">
      <Text style={styles.heading} accessibilityRole="header">
        A new version of Reduction is ready
      </Text>
      <Text style={styles.body}>
        This version will not get any more updates. Open TestFlight and tap Update to get the new one. Your recipes and books come with you.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={openTestFlight}
        style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        testID="update-notice-open"
      >
        <Text style={styles.primaryText}>Open TestFlight</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.ghost} testID="update-notice-later">
        <Text style={styles.ghostText}>Not now</Text>
      </Pressable>
    </Window>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    heading: { marginTop: 4, fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    body: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    primary: {
      marginTop: 18,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    primaryPressed: { opacity: 0.85 },
    primaryText: { fontSize: 15, fontWeight: '600', color: colors.primaryForeground },
    ghost: { marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    ghostText: { fontSize: 15, color: colors.mutedForeground },
  });
}
