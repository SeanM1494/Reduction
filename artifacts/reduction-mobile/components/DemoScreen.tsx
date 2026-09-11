/**
 * components/DemoScreen.tsx — the guacamole demo, the app's first screen.
 *
 * The first-run decision (ROADMAP, mobile section): the demo IS the entry
 * point, fully explorable before sign-in, and sign-in gates saving only.
 * `app/_layout.tsx`'s Gate renders this in place of the whole navigator
 * while there is no token, so there is no Stack here; RecipeScreen needs
 * nothing from one. "Sign in" in the header hands over to SignInScreen.
 *
 * It is the web landing demo ported, teaching layer included: the coach
 * line, the two tips, the legend and "Watch it" come from
 * components/demo/DemoCoach.tsx, which wraps RecipeScreen through its two
 * slots and never reaches into it. Everything lives in component state and
 * dies with it — no API calls, no rows (CLAUDE.md, "Demo state never
 * persists").
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { SheetButton } from '@/components/Sheet';
import {
  buildDemoGraph,
  CoachLegend,
  CoachLine,
  CoachTip,
  DemoTag,
  useCoachStage,
  useCoachTips,
  useWatchPlayer,
  watchOrder,
} from '@/components/demo/DemoCoach';
import { DEMO_PRECHECKED, DEMO_RECIPE } from '@/data/demoRecipe';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';

export function DemoScreen({ onSignIn }: { onSignIn: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const section = DEMO_RECIPE.sections[0];
  // Pre-checked so the demo never opens flat — one step visibly ready
  // before any interaction, as on the web landing page.
  const [done, setDone] = useState<string[]>(DEMO_PRECHECKED);
  const [timer, setTimer] = useState<StepTimer | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [mode, setMode] = useState<'diagram' | 'steps'>('diagram');

  const doneSet = useMemo(() => new Set(done), [done]);
  const graph = useMemo(() => buildDemoGraph(section, DEMO_PRECHECKED), [section]);
  const order = useMemo(() => watchOrder(section, DEMO_PRECHECKED), [section]);
  const { playing, line: narration, play, stop } = useWatchPlayer(order, DEMO_PRECHECKED, setDone);
  const { text: coachText } = useCoachStage(graph, doneSet, DEMO_PRECHECKED, mode);
  // Both tips describe the grid, so they are held (not spent) while Cook
  // mode is up, and while autoplay is driving.
  const { text: tipText, resetTips } = useCoachTips(graph, doneSet, { suspended: playing || mode !== 'diagram' });

  const reset = useCallback(() => {
    stop();
    resetTips();
    setTimer(null);
    setServings(null);
    setDone(DEMO_PRECHECKED);
  }, [stop, resetTips]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <DemoTag />
        <Text style={styles.title} numberOfLines={1}>
          {DEMO_RECIPE.title}
        </Text>
        <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signIn} testID="demo-sign-in">
          <Text style={styles.signInText}>Sign in →</Text>
        </Pressable>
      </View>
      <RecipeScreen
        recipe={DEMO_RECIPE}
        done={done}
        servings={servings}
        timer={timer}
        cooked={[]}
        rating={null}
        mode={mode}
        canEdit={false}
        onUpdate={(patch) => {
          // Any interaction stops autoplay and keeps the progress it made.
          if (patch.done) {
            stop();
            setDone(patch.done);
          }
          if ('servings' in patch) setServings(patch.servings ?? null);
          if ('timer' in patch) setTimer(patch.timer ?? null);
          if (patch.mode) {
            stop();
            setMode(patch.mode);
          }
        }}
        above={
          <View>
            <View style={styles.actions}>
              <SheetButton label={playing ? 'Stop' : 'Watch it'} onPress={playing ? stop : play} testID="demo-watch" />
              <SheetButton label="Reset" onPress={reset} testID="demo-reset" />
            </View>
            <CoachLine text={narration ?? coachText} />
            <CoachTip text={tipText} />
          </View>
        }
        overviewFooter={<CoachLegend />}
        showServings={false}
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
      gap: 10,
      paddingLeft: 20,
      paddingRight: 12,
      paddingTop: 4,
      minHeight: 48,
    },
    title: { flex: 1, fontFamily: fonts.heading, fontSize: 17, color: colors.foreground },
    signIn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    signInText: { fontFamily: fonts.heading, fontSize: 15, color: colors.foreground },
    actions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  });
}
