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
 * and the rest dimmed. Every run opens on a welcome card (Oct 1): "Start the
 * tour", "Skip" (the recipe is free to explore) or "Watch instead". The steps and every rule about
 * them are lib/demoGuide.ts (pure, tested); this screen only keeps the
 * state and wires the buttons. A do-step advances on the demo's real state
 * changing the way it asked; a tap it did not ask for is kept and nudged,
 * never blocked. "Watch instead" (Oct 1) is the same guide played by
 * itself: lib/demoWatch.ts turns each step into beats (wait, point, tap,
 * advance) and this screen runs them on timers, with a pointer drawn
 * inside each target through the spotlight. Pause, Back and Next only stop,
 * restart or replace those timers; a tap of your own takes over the guide.
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
import { CoachLegend, DemoTag } from '@/components/demo/DemoCoach';
import { announce, GuideCard } from '@/components/demo/GuideCard';
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
import type { Pointer, Spotlight } from '@/lib/spotlight';
import { targetName, watchBeats, type Beat } from '@/lib/demoWatch';
import { useA11yFlags } from '@/hooks/useA11yFlags';

/** A do-step that has just been done holds a beat before the next one, so
 *  the result of the tap is seen before the instruction changes. */
const ADVANCE_DELAY_MS = 700;
/** Show me's taps, one after another, at a pace that can be followed. */
const SHOW_ME_STEP_MS = 700;

/** welcome: the card before every run. free: the welcome skipped, the
 *  recipe to explore. guided / watching: the tour, done or watched. */
type Phase = 'welcome' | 'free' | 'guided' | 'watching';

export function DemoScreen({ onSignIn }: { onSignIn?: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const section = DEMO_RECIPE.sections[0];
  const graph = useMemo(() => demoGraph(DEMO_RECIPE, DEMO_PRECHECKED), []);
  const cardOrder = useMemo(() => cardSequence(DEMO_RECIPE).map((c) => c.stepId), []);

  // Nothing checked, like a real recipe (data/demoRecipe.ts).
  const [state, setStateRaw] = useState<DemoState>({ done: DEMO_PRECHECKED, mode: 'diagram' });
  const [timer, setTimer] = useState<StepTimer | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('welcome');
  const [run, setRun] = useState<GuideRun | null>(null);
  const [nudge, setNudge] = useState(false);
  const [showMeReady, setShowMeReady] = useState(false);
  // Bumped by every change while guided: restarts the Show me clock.
  const [activity, setActivity] = useState(0);
  // Watch instead: the pointer on screen, and whether the tour is paused.
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [paused, setPaused] = useState(false);
  const a11y = useA11yFlags();

  // The handlers below run from timers and from callbacks built in earlier
  // renders, so they read the live values through refs.
  const stateRef = useRef(state);
  const runRef = useRef(run);
  const phaseRef = useRef(phase);
  const pending = useRef<ReturnType<typeof setTimeout>[]>([]);
  const watchRef = useRef<{ beats: Beat[]; at: number } | null>(null);
  const pausedRef = useRef(false);
  const seqRef = useRef(0);
  const a11yRef = useRef(a11y);
  // Refs are written in effects, never during render (the React Compiler).
  useEffect(() => {
    a11yRef.current = { reduceMotion: a11y.reduceMotion, screenReader: a11y.screenReader };
  }, [a11y.reduceMotion, a11y.screenReader]);
  const startStepRef = useRef<() => void>(() => {});
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
      watchRef.current = null;
      setPointer(null);
      setNudge(false);
      setShowMeReady(false);
      setActivity((n) => n + 1);
      if (!next) {
        // Back out of the guide: the start of a run, so the welcome again.
        setRunBoth(null);
        setPhaseBoth('welcome');
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

  /** Every change to the demo's state goes through here: a tap, a tab, and
   *  Show me's own taps — so Show me is judged by the same rule as a finger. */
  const apply = useCallback(
    (next: DemoState) => {
      if (phaseRef.current === 'watching') {
        // A tap of your own takes over: the guide, at the step being
        // watched, judging this tap like any other.
        clearPending();
        watchRef.current = null;
        setPointer(null);
        setPhaseBoth('guided');
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
    [graph, goTo, clearPending, setPhaseBoth, setState]
  );

  // ------------------------------------------------------- Watch instead --

  /** Run beat `i` of the current step, and schedule the next. */
  const runBeat = useCallback(
    function runBeat(i: number) {
      const w = watchRef.current;
      if (!w || phaseRef.current !== 'watching' || pausedRef.current) return;
      w.at = i;
      const beat = w.beats[i];
      if (!beat) return; // the step is done; under VoiceOver, Next moves on
      if (beat.kind === 'advance') {
        const r = runRef.current;
        if (!r) return;
        const next = forward(r, stateRef.current, graph);
        if (GUIDE_STEPS[next.run.index].kind === 'finish') {
          goTo(next); // the final card, as the guide shows it
          return;
        }
        setRunBoth(next.run);
        setState(next.state);
        startStepRef.current();
        return;
      }
      if (beat.kind === 'wait') setPointer(null);
      if (beat.kind === 'point') {
        seqRef.current += 1;
        setPointer({ id: beat.target, phase: 'approach', seq: seqRef.current, still: a11yRef.current.reduceMotion });
      }
      if (beat.kind === 'tap') {
        setPointer({ id: beat.target, phase: 'tap', seq: seqRef.current, still: a11yRef.current.reduceMotion });
        announce(`Tapping ${targetName(DEMO_RECIPE, beat.target)}.`);
      }
      pending.current.push(
        setTimeout(() => {
          if (watchRef.current !== w) return;
          if (beat.kind === 'tap') {
            // The state changes only once the tap has landed.
            const s = stateRef.current;
            const a = beat.action;
            setState(a.kind === 'tap' ? tapState(DEMO_RECIPE, s, a.id) : a.kind === 'mode' ? { ...s, mode: a.mode } : nextState(DEMO_RECIPE, s, cardOrder));
            setPointer(null);
          }
          runBeat(i + 1);
        }, beat.ms)
      );
    },
    [graph, goTo, cardOrder, setRunBoth, setState]
  );

  /** The current step's beats, from the state it starts in. */
  const startStep = useCallback(() => {
    clearPending();
    setPointer(null);
    const r = runRef.current;
    if (!r) return;
    const flags = a11yRef.current;
    watchRef.current = { beats: watchBeats(GUIDE_STEPS[r.index].id, stateRef.current, graph, flags), at: 0 };
    runBeat(0);
  }, [clearPending, graph, runBeat]);
  useEffect(() => {
    startStepRef.current = startStep;
  }, [startStep]);

  /** Watch instead: always from the clean start. */
  const watch = useCallback(() => {
    clearPending();
    const start = startRun(graph);
    setTimer(null);
    setNudge(false);
    setShowMeReady(false);
    pausedRef.current = false;
    setPaused(false);
    setRunBoth(start.run);
    setState(start.state);
    setPhaseBoth('watching');
    startStep();
  }, [clearPending, graph, setRunBoth, setState, setPhaseBoth, startStep]);

  /** Back or Next while watching: that step, from where it starts. */
  const watchMove = useCallback(
    (next: { run: GuideRun; state: DemoState } | null) => {
      const r = runRef.current;
      if (!r) return;
      const to = next ?? { run: r, state: r.snapshots[0] }; // Back on step 1: step 1 again
      if (GUIDE_STEPS[to.run.index].kind === 'finish') {
        goTo(to);
        return;
      }
      setRunBoth(to.run);
      setState(to.state);
      startStep();
    },
    [goTo, setRunBoth, setState, startStep]
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    clearPending();
  }, [clearPending]);
  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const w = watchRef.current;
    if (w) runBeat(w.at); // the interrupted beat, from its start
    else startStep();
  }, [runBeat, startStep]);

  /** Try it yourself: the guide, at the step being watched, as it began. */
  const tryYourself = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    goTo({ run: r, state: r.snapshots[r.index] });
  }, [goTo]);

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
    if ((phase !== 'guided' && phase !== 'watching') || !run) return null;
    const id = GUIDE_STEPS[run.index].id;
    return {
      targets: new Set(targetsFor(id, state, graph)),
      dimOthers: dimsFor(id, state, graph),
      pointer: phase === 'watching' ? pointer : null,
    };
  }, [phase, run, state, graph, pointer]);

  const finish = useCallback(() => {
    if (onSignIn) onSignIn();
    else router.dismissTo('/');
  }, [onSignIn]);

  // Skip: on the landing the demo stays open to explore, with the tour a
  // tap away (there is nowhere else to find it); from Settings or the
  // library the card simply closes — the header's back button leaves, and
  // coming back shows the welcome again.
  const skip = useCallback(() => setPhaseBoth('free'), [setPhaseBoth]);
  // Replay is a new run: the welcome card, from a clean start.
  const replay = useCallback(() => goTo(null), [goTo]);

  const card =
    phase === 'welcome' ? (
      <GuideCard phase="welcome" onStart={() => goTo(startRun(graph))} onSkip={skip} onWatch={watch} />
    ) : phase === 'free' ? (
      onSignIn ? <GuideCard phase="free" onStart={() => goTo(startRun(graph))} onWatch={watch} /> : null
    ) : phase === 'watching' && run ? (
      <GuideCard
        phase="watching"
        index={run.index}
        paused={paused}
        screenReader={a11y.screenReader}
        onBack={() => watchMove(back(run))}
        onNext={() => watchMove(forward(run, stateRef.current, graph))}
        onPause={pause}
        onResume={resume}
        onTry={tryYourself}
      />
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
        onReplay={replay}
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
          stars={null}
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
