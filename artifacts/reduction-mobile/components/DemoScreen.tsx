/**
 * components/DemoScreen.tsx — the guacamole demo, reachable before sign-in.
 *
 * Rendered directly by SignInScreen instead of through expo-router: while
 * there is no token, `app/_layout.tsx`'s Gate mounts SignInScreen in place
 * of the whole navigator (see its header comment), so there is no Stack to
 * push a route onto yet. RecipeScreen itself needs nothing from that
 * navigator — it's a pure props-in component — so it renders here with
 * local, in-memory `done`/`timer` state and its own minimal header, the same
 * "never persists" shape as the web landing page's demo.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { DEMO_RECIPE } from '@/data/demoRecipe';
import { STRESS_RECIPE } from '@/components/diagram/stressFixture';
import { FpsMeter } from '@/components/diagram/FpsMeter';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';

const PERF_STRIP = __DEV__ || process.env.EXPO_PUBLIC_PERF_STRIP === '1';

export function DemoScreen({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // Pre-checked so the demo never opens flat — mirrors DEMO_PRECHECKED on
  // the web landing page, one step visibly ready before any interaction.
  const [done, setDone] = useState<string[]>(['avocados']);
  const [timer, setTimer] = useState<StepTimer | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  // The Phase 0 kill-criterion read, taken in the real demo rather than on
  // the spike route (which Expo Go could not be deep-linked into). The stress
  // fixture and the frame meter show in a dev bundle, or in a release bundle
  // built with EXPO_PUBLIC_PERF_STRIP=1 — the flag is inlined at build time,
  // so a normal release build dead-code-eliminates the whole branch. The
  // flag exists for exactly one purpose: a minified web export the phone can
  // open in Safari to answer criterion 2 while Expo Go is walled off.
  const [stress, setStress] = useState(false);
  const recipe = PERF_STRIP && stress ? STRESS_RECIPE : DEMO_RECIPE;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onClose} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Demo</Text>
        {PERF_STRIP ? (
          <Pressable
            style={styles.back}
            testID="demo-stress-toggle"
            onPress={() => {
              setStress((v) => !v);
              setDone([]);
            }}
            hitSlop={12}
          >
            <Text style={[styles.backText, { textAlign: 'right' }]}>{stress ? 'demo' : 'stress'}</Text>
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
      </View>
      {/* The meter positions itself top-right of its container; give it a
          strip of its own so it never covers the header's controls. */}
      {PERF_STRIP ? (
        <View style={{ height: 36 }}>
          <FpsMeter />
        </View>
      ) : null}
      {/* A synthetic in-memory entry: done, servings and the timer live in
          component state and die with it (CLAUDE.md, "Demo state never
          persists"). canEdit off keeps rating and tagging out of the demo. */}
      <RecipeScreen
        recipe={recipe}
        done={done}
        servings={servings}
        timer={timer}
        cooked={[]}
        rating={null}
        mode="diagram"
        canEdit={false}
        onUpdate={(patch) => {
          if (patch.done) setDone(patch.done);
          if ('servings' in patch) setServings(patch.servings ?? null);
          if ('timer' in patch) setTimer(patch.timer ?? null);
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    back: { minWidth: 60 },
    backText: { color: colors.foreground, fontFamily: fonts.headingMedium, fontSize: 16 },
    backSpacer: { minWidth: 60 },
    headerTitle: { color: colors.foreground, fontFamily: fonts.headingMedium, fontSize: 16 },
  });
}
