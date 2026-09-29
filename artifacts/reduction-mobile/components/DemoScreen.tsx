/**
 * components/DemoScreen.tsx — the guacamole demo, the app's first screen.
 *
 * The first-run decision (ROADMAP, mobile section): the demo IS the entry
 * point, fully explorable before sign-in, and sign-in gates saving only.
 * `app/_layout.tsx`'s Gate renders this in place of the whole navigator
 * while there is no token, so there is no Stack here; RecipeScreen needs
 * nothing from one. "Sign in" in the header hands over to SignInScreen.
 *
 * The teaching is a GUIDE (Sep 29): one instruction at a time on a card
 * under the recipe (components/demo/GuideCard.tsx), the thing to tap ringed
 * and the rest dimmed. It does not start by itself — "Start the demo" — and
 * until then the recipe is free to explore. The steps and every rule about
 * them are lib/demoGuide.ts (pure, tested); this screen only keeps the
 * state and wires the buttons. A do-step advances on the demo's real state
 * changing the way it asked; a tap it did not ask for is kept and nudged,
 * never blocked. "Watch instead" is the old autoplay.
 *
 * The ring is drawn by the screens it points into, through RecipeScreen's
 * `spotlight` — ids from the recipe's graph, never a position or a class
 * name (CLAUDE.md, "The demo teaches through a wrapper, not a fork").
 * Everything lives in component state and dies with it — no API calls, no
 * rows (CLAUDE.md, "Demo state never persists").
 *
 * It has a second home once someone is signed in: `app/demo.tsx`, reached
 * from Settings › "How it works" and from an empty library, pushes it as an
 * ordinary screen. There the navigator's header carries the back button,
 * the title and the DEMO tag, so this screen drops its own header row and
 * its top inset — `onSignIn` absent is what says which home it is in.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RecipeScreen } from '@/components/RecipeScreen';
import { CoachLegend, DemoTag, useWatchPlayer, watchOrder } from '@/components/demo/DemoCoach';
import { GuideCard } from '@/components/demo/GuideCard';
import { DEMO_PRECHECKED, DEMO_RECIPE } from '@/data/demoRecipe';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';
import { cardSequence } from '@/shared/sequence';
import {
  advances,
  back,
  demoGraph,
  dimsFor,
  forward,
  GUIDE_STEPS,
  isWrongMove,
  nextState,
  SHOW_ME_AFTER_MS,
  showMe,
  startRun,
  stranded,
  targetsFor,
  tapState,
  type DemoState,
  type GuideRun,
} from '@/lib/demoGuide';
import type { Spotlight } from '@/lib/spotlight';

/** A do-step that has just been done holds a beat before the next one, so
 *  the result of the tap is seen before the instruction changes. */
const ADVANCE_DELAY_MS = 700;
/** Show me's taps, one after another, at a pace that can be followed. */
const SHOW_ME_STEP_MS = 700;

type Phase = 'idle' | 'guided' | 'watching';

export function DemoScreen({ onSignIn }: { onSignIn?: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const section = DEMO_RECIPE.sections[0];
  const graph = useMemo(() => demoGraph(DEMO_RECIPE, DEMO_PRECHECKED), []);
  const cardOrder = useMemo(() => cardSequence(DEMO_RECIPE).map((c) => c.stepId), []);

  // Pre-checked so the demo never opens flat — one step visibly ready
  // before any interaction, as on the web landing page.
  const [state, setStateRaw] = useState<DemoState>({ done: DEMO_PRECHECKED, mode: 'diagram' });
  const [timer, setTimer] = useState<StepTimer | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [run, setRun] = useState<GuideRun | null>(null);
  const [nudge, setNudge] = useState(false);
  const [showMeReady, setShowMeReady] = useState(false);
  // Bumped by every change while guided: restarts the Show me clock.
  const [activity, setActivity] = useState(0);

  // The handlers below run from timers and from callbacks built in earlier
  // renders, so they read the live values through refs.
  const stateRef = useRef(state);
  const runRef = useRef(run);
  const phaseRef = useRef(phase);
  const pending = useRef<ReturnType<typeof setTimeout>[]>([]);
  const setState = useCallback((next: DemoState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const setRunBoth = useCallback((next: GuideRun | null) => {
    runRef.current = next;
    setRun(next);
  }, []);
  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const clearPending = useCallback(() => {
    pending.current.forEach((t) => clearTimeout(t));
    pending.current = [];
  }, []);
  useEffect(() => clearPending, [clearPending]);

  const goTo = useCallback(
    (next: { run: GuideRun; state: DemoState } | null) => {
      clearPending();
      setNudge(false);
      setShowMeReady(false);
      setActivity((n) => n + 1);
      if (!next) {
        setRunBoth(null);
        setPhaseBoth('idle');
        setState({ done: DEMO_PRECHECKED, mode: 'diagram' });
        return;
      }
      setTimer(null);
      setRunBoth(next.run);
      setPhaseBoth('guided');
      setState(next.state);
    },
    [clearPending, setRunBoth, setPhaseBoth, setState]
  );

  // Watch instead: the autoplay, from the opening position, and then the
  // last step of the guide ("That's it") — watching is a way through it.
  const order = useMemo(() => watchOrder(section, DEMO_PRECHECKED), [section]);
  const setDoneFromPlayer = useCallback(
    (done: string[]) => setState({ done, mode: 'diagram' }),
    [setState]
  );
  const onWatchEnd = useCallback(() => {
    let r = startRun(graph);
    for (let i = 1; i < GUIDE_STEPS.length; i++) r = forward(r.run, stateRef.current, graph);
    // Keep what the player left on screen: every step checked.
    goTo({ run: r.run, state: stateRef.current });
  }, [graph, goTo]);
  const { line: narration, play, stop } = useWatchPlayer(order, DEMO_PRECHECKED, setDoneFromPlayer, onWatchEnd);

  const watch = useCallback(() => {
    clearPending();
    setRunBoth(null);
    setNudge(false);
    setPhaseBoth('watching');
    setState({ done: DEMO_PRECHECKED, mode: 'diagram' });
    play();
  }, [clearPending, setRunBoth, setPhaseBoth, setState, play]);

  const stopWatching = useCallback(() => {
    stop();
    setPhaseBoth('idle');
  }, [stop, setPhaseBoth]);

  /** Every change to the demo's state goes through here: a tap, a tab, and
   *  Show me's own taps — so Show me is judged by the same rule as a finger. */
  const apply = useCallback(
    (next: DemoState) => {
      if (phaseRef.current === 'watching') {
        // Any interaction stops autoplay and keeps the progress it made.
        stop();
        setPhaseBoth('idle');
      }
      const prev = stateRef.current;
      setState(next);
      const r = runRef.current;
      if (phaseRef.current !== 'guided' || !r) return;
      setActivity((n) => n + 1);
      setShowMeReady(false);
      const id = GUIDE_STEPS[r.index].id;
      if (advances(id, prev, next, graph)) {
        setNudge(false);
        clearPending();
        pending.current.push(
          setTimeout(() => {
            if (runRef.current !== r) return;
            goTo(forward(r, stateRef.current, graph));
          }, ADVANCE_DELAY_MS)
        );
      } else if (isWrongMove(id, prev, next, graph)) {
        setNudge(true);
        if (stranded(id, next, graph)) {
          // Their tap happened and is seen; then the step is put back where
          // it began, because what it asked for is no longer there to tap.
          clearPending();
          pending.current.push(
            setTimeout(() => {
              if (runRef.current !== r) return;
              setState(r.snapshots[r.index]);
            }, ADVANCE_DELAY_MS)
          );
        }
      }
    },
    [graph, goTo, clearPending, stop, setPhaseBoth, setState]
  );

  const doShowMe = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    clearPending();
    setShowMeReady(false);
    const actions = showMe(GUIDE_STEPS[r.index].id, stateRef.current, graph);
    actions.forEach((a, i) => {
      pending.current.push(
        setTimeout(() => {
          if (runRef.current !== r) return;
          const s = stateRef.current;
          if (a.kind === 'tap') apply(tapState(DEMO_RECIPE, s, a.id));
          else if (a.kind === 'mode') apply({ ...s, mode: a.mode });
          else apply(nextState(DEMO_RECIPE, s, cardOrder));
        }, i * SHOW_ME_STEP_MS)
      );
    });
  }, [graph, apply, cardOrder, clearPending]);

  // Show me is offered after a quiet spell on a do-step, never at once:
  // the point is to try it.
  const stepKind = phase === 'guided' && run ? GUIDE_STEPS[run.index].kind : null;
  useEffect(() => {
    if (stepKind !== 'do') return;
    const t = setTimeout(() => setShowMeReady(true), SHOW_ME_AFTER_MS);
    return () => clearTimeout(t);
  }, [stepKind, run, activity]);

  const spotlight: Spotlight | null = useMemo(() => {
    if (phase !== 'guided' || !run) return null;
    const id = GUIDE_STEPS[run.index].id;
    return { targets: new Set(targetsFor(id, state, graph)), dimOthers: dimsFor(id, state, graph) };
  }, [phase, run, state, graph]);

  const finish = useCallback(() => {
    if (onSignIn) onSignIn();
    else router.dismissTo('/');
  }, [onSignIn]);

  const card =
    phase === 'idle' ? (
      <GuideCard phase="idle" onStart={() => goTo(startRun(graph))} onWatch={watch} />
    ) : phase === 'watching' ? (
      <GuideCard phase="watching" narration={narration} onStop={stopWatching} />
    ) : (
      <GuideCard
        phase="guided"
        index={run!.index}
        nudge={nudge}
        showMe={showMeReady}
        signedIn={!onSignIn}
        onBack={() => goTo(back(run!))}
        onSkip={() => goTo(forward(run!, stateRef.current, graph))}
        onNext={() => goTo(forward(run!, stateRef.current, graph))}
        onShowMe={doShowMe}
        onWatch={watch}
        onFinish={finish}
        onReplay={() => goTo(startRun(graph))}
      />
    );

  return (
    <SafeAreaView style={styles.container} edges={onSignIn ? ['top', 'bottom'] : ['bottom']}>
      {onSignIn ? (
        <View style={styles.header}>
          <DemoTag />
          <Text style={styles.title} numberOfLines={1}>
            {DEMO_RECIPE.title}
          </Text>
          <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signIn} testID="demo-sign-in">
            <Text style={styles.signInText}>Sign in →</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.recipe}>
        <RecipeScreen
          recipe={DEMO_RECIPE}
          done={state.done}
          servings={servings}
          timer={timer}
          cooked={[]}
          rating={null}
          mode={state.mode}
          canEdit={false}
          spotlight={spotlight}
          modeControlled
          onUpdate={(patch) => {
            if ('servings' in patch) setServings(patch.servings ?? null);
            if ('timer' in patch) setTimer(patch.timer ?? null);
            if (patch.done || patch.mode) {
              const s = stateRef.current;
              apply({ done: patch.done ?? s.done, mode: patch.mode ?? s.mode });
            }
          }}
          overviewFooter={<CoachLegend />}
        />
      </View>
      {card}
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    recipe: { flex: 1 },
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
  });
}
