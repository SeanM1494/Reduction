/**
 * components/demo/DemoCoach.tsx — the first-run demo's teaching layer, the
 * web's DemoCoach.tsx ported.
 *
 * The demo already shows what the app does. This makes it teach how it
 * works, through interaction alone: no modal, no overlay tour, nothing to
 * dismiss before the diagram is usable. Four parts, all driven by the same
 * `done` set the diagram is driven by:
 *   useCoachStage   one sentence that reacts to where the visitor actually is
 *   useCoachTips    two contextual tips, once each, never two at once
 *   CoachLegend     the three cell states, as swatches in the diagram's tokens
 *   useWatchPlayer  the autoplay sequence behind "Watch it"
 *
 * This layer wraps RecipeScreen — it never reaches into it. No testIDs, no
 * anchoring to a cell, no imports from layout.ts. Everything here is derived
 * from the recipe's own graph and the `done` set, so a DiagramView refactor
 * cannot break the coaching (CLAUDE.md, "The demo teaches through a wrapper,
 * not a fork").
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import type { Section } from '@/shared/layout';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { doneBackground } from '@/components/diagram/DiagramView';

/** Steps advance this fast during autoplay. Slow enough to read a label. */
const WATCH_STEP_MS = 600;
/** A step that brings a new sentence with it holds longer. */
const WATCH_NARRATED_MS = 1400;

/** The demo, told as someone cooking it. Keyed by id, never by position, so
 *  editing the fixture drops a sentence rather than attaching it to the
 *  wrong step. Ids with no entry hold whatever sentence is already up. */
const DEMO_NARRATION: Record<string, string> = {
  d1: 'Olivia halved three avocados and scooped them into a bowl.',
  lime: 'She squeezed in the lime and added a pinch of salt.',
  d2: 'Mashed it until it was chunky, not smooth.',
  onion: 'Onion, tomato, jalapeño and cilantro went in together.',
  d4: 'She folded the two bowls into one.',
  d5: 'Then a ten-minute rest, while the flavors came together.',
};

// ---------------------------------------------------------------- graph ----

export interface DemoGraph {
  opIds: string[];
  ingredientIds: string[];
  inputsOf: Map<string, string[]>;
  /** The first step fed by two or more *steps* — "fold together". Null for
   *  a recipe that never branches. */
  joinId: string | null;
  /** Ops already ready before anyone touches anything, so the amber tip
   *  never fires for a state the visitor did not cause. */
  initiallyReadyOps: Set<string>;
  allIds: string[];
}

export function buildDemoGraph(section: Section, prechecked: string[]): DemoGraph {
  const opIds = section.nodes.map((n) => n.id);
  const ingredientIds = section.ingredients.map((i) => i.id);
  const isOp = new Set(opIds);
  const inputsOf = new Map<string, string[]>();
  for (const n of section.nodes) inputsOf.set(n.id, n.inputs || []);
  const joinId = section.nodes.find((n) => (n.inputs || []).filter((i) => isOp.has(i)).length >= 2)?.id ?? null;
  const start = new Set(prechecked);
  const initiallyReadyOps = new Set(opIds.filter((id) => (inputsOf.get(id) || []).every((i) => start.has(i))));
  return { opIds, ingredientIds, inputsOf, joinId, initiallyReadyOps, allIds: [...ingredientIds, ...opIds] };
}

/** Autoplay order: a post-order walk from the root, so every input is
 *  emitted before the step that consumes it. Anything already checked at
 *  the start is dropped — it is the baseline the player replays from. */
export function watchOrder(section: Section, prechecked: string[]): string[] {
  const inputs = new Map<string, string[]>();
  for (const n of section.nodes) inputs.set(n.id, n.inputs || []);
  const start = new Set(prechecked);
  const out: string[] = [];
  const seen = new Set<string>();
  (function walk(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    (inputs.get(id) || []).forEach(walk);
    if (!start.has(id)) out.push(id);
  })(section.root);
  return out;
}

function readyOps(graph: DemoGraph, done: Set<string>): Set<string> {
  return new Set(graph.opIds.filter((id) => !done.has(id) && (graph.inputsOf.get(id) || []).every((i) => done.has(i))));
}

// ---------------------------------------------------------------- stage ----

export type CoachStage = 'empty' | 'firstIngredient' | 'stepReady' | 'converging' | 'complete';

const STAGE_TEXT: Record<CoachStage, string> = {
  empty: 'Guacamole, as a diagram. Tap any ingredient to check it off.',
  firstIngredient: 'Each box to the right lights up as soon as everything feeding into it is checked.',
  stepReady: 'That step turned amber because everything it needs is now done.',
  converging: "Both branches are finished, so folding them together is all that's left.",
  complete: "That's the whole recipe — no scrolling back up a wall of paragraphs.",
};

/** Cook mode has no grid, no columns and nothing amber, so the three stages
 *  that describe those get a second phrasing. */
const STEPS_STAGE_TEXT: Partial<Record<CoachStage, string>> = {
  empty: 'Guacamole, step by step. Check one off to bring up the next.',
  firstIngredient: 'A card only comes up once everything it needs is checked off.',
  stepReady: 'That step unlocked because everything it needs is now done.',
};

export function useCoachStage(
  graph: DemoGraph,
  done: Set<string>,
  prechecked: string[],
  view: 'diagram' | 'steps'
): { stage: CoachStage; text: string } {
  return useMemo(() => {
    const stage: CoachStage = (() => {
      if (graph.allIds.every((id) => done.has(id))) return 'complete';
      if (graph.joinId) {
        const feeders = (graph.inputsOf.get(graph.joinId) || []).filter((i) => graph.opIds.includes(i));
        if (feeders.length >= 2 && feeders.every((f) => done.has(f))) return 'converging';
      }
      const ready = readyOps(graph, done);
      for (const id of ready) if (!graph.initiallyReadyOps.has(id)) return 'stepReady';
      if (graph.opIds.some((id) => done.has(id))) return 'stepReady';
      const start = new Set(prechecked);
      if (graph.ingredientIds.some((id) => done.has(id) && !start.has(id))) return 'firstIngredient';
      return 'empty';
    })();
    const text = (view === 'steps' ? STEPS_STAGE_TEXT[stage] : undefined) ?? STAGE_TEXT[stage];
    return { stage, text };
  }, [graph, done, prechecked, view]);
}

// ----------------------------------------------------------------- tips ----

export type TipId = 'amber' | 'jump';

const TIP_TEXT: Record<TipId, string> = {
  amber: 'Amber means you can do this now — everything it depends on is already checked.',
  jump: 'You can skip ahead: tap any step further right and everything it needs gets checked along with it.',
};

/** Two tips, one at a time, once each, each dismissed by the next
 *  interaction. Driven by watching `done` change, so autoplay, Reset and
 *  ordinary taps all flow through one path. */
export function useCoachTips(
  graph: DemoGraph,
  done: Set<string>,
  opts: { suspended: boolean }
): { tip: TipId | null; text: string | null; resetTips: () => void } {
  const [tip, setTip] = useState<TipId | null>(null);
  const shown = useRef<Set<TipId>>(new Set());
  const prevReady = useRef<Set<string> | null>(null);
  const tipRef = useRef<TipId | null>(null);
  tipRef.current = tip;
  const suspended = opts.suspended;

  useEffect(() => {
    const ready = readyOps(graph, done);
    if (prevReady.current === null) {
      prevReady.current = ready;
      return;
    }
    const previous = prevReady.current;
    prevReady.current = ready;
    if (suspended) return;
    // An active tip is dismissed by this change, whatever it was. Read
    // through a ref so this effect runs only when `done` moves, never when
    // the tip itself changes (that would dismiss it the instant it appeared).
    if (tipRef.current !== null) {
      setTip(null);
      return;
    }
    const newlyReady = [...ready].filter((id) => !previous.has(id) && !graph.initiallyReadyOps.has(id));
    if (!shown.current.has('amber') && newlyReady.length > 0) {
      shown.current.add('amber');
      setTip('amber');
      return;
    }
    const jumpTarget = graph.opIds.some((id) => !done.has(id) && !ready.has(id));
    if (shown.current.has('amber') && !shown.current.has('jump') && jumpTarget) {
      shown.current.add('jump');
      setTip('jump');
    }
  }, [done, graph, suspended]);

  const resetTips = useCallback(() => {
    shown.current = new Set();
    prevReady.current = null;
    setTip(null);
  }, []);

  return { tip, text: tip ? TIP_TEXT[tip] : null, resetTips };
}

// ---------------------------------------------------------------- watch ----

/** Autoplay for "Watch it". Always replays from the opening position; any
 *  interaction stops it mid-run and leaves the progress it made in place. */
export function useWatchPlayer(
  order: string[],
  prechecked: string[],
  setDone: (next: string[]) => void
): { playing: boolean; line: string | null; play: () => void; stop: () => void } {
  const [playing, setPlaying] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduceMotion = useRef(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((r) => {
        if (!cancelled) reduceMotion.current = r;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setLine(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    stop();
    if (reduceMotion.current) {
      // One commit, and no narration: six sentences flashing past in as many
      // frames is worse than none, and there is no motion left to narrate.
      setDone([...prechecked, ...order]);
      return;
    }
    setPlaying(true);
    setDone([...prechecked]);
    let at = 0;
    order.forEach((id, i) => {
      const sentence = DEMO_NARRATION[id];
      at += sentence ? WATCH_NARRATED_MS : WATCH_STEP_MS;
      timers.current.push(
        setTimeout(() => {
          setDone([...prechecked, ...order.slice(0, i + 1)]);
          if (sentence) setLine(sentence);
        }, at)
      );
    });
    timers.current.push(
      setTimeout(() => {
        setPlaying(false);
        setLine(null);
      }, at + WATCH_NARRATED_MS)
    );
  }, [order, prechecked, setDone, stop]);

  return { playing, line, play, stop };
}

// --------------------------------------------------------------- pieces ----

/** The coach line: one sentence, faded in on every change. During "Watch
 *  it" the narration stands in for it — one line, never both. */
export function CoachLine({ text }: { text: string }) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [text, opacity]);
  return (
    <View style={styles.coach} accessibilityLiveRegion="polite">
      <Animated.Text style={[styles.coachText, { color: colors.foreground, opacity }]} testID="coach-line">
        {text}
      </Animated.Text>
    </View>
  );
}

/** A tip, or the empty slot it occupies. The slot is always rendered so a
 *  tip appearing never reflows the diagram below it. */
export function CoachTip({ text }: { text: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.tipSlot} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {text ? (
        <View style={[styles.tip, { backgroundColor: colors.warmBg, borderColor: colors.dangerLine, borderLeftColor: colors.warmLine }]}>
          <Text style={[styles.tipText, { color: colors.warmInk }]} testID="coach-tip">
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Says "this is a sample" once. */
export function DemoTag() {
  const colors = useColors();
  return (
    <View style={[styles.tag, { backgroundColor: colors.warmBg, borderColor: colors.dangerLine }]}>
      <Text style={[styles.tagText, { color: colors.warmInk }]}>DEMO</Text>
    </View>
  );
}

/** The three states as swatches in the diagram's own tokens (the web reuses
 *  the diagram's cell classes; here the shared token helper keeps the two
 *  from drifting). Decorative: a sentence carries the same content. */
export function CoachLegend() {
  const colors = useColors();
  const done = doneBackground(colors);
  return (
    <View style={styles.legend} accessibilityLabel="Steps show three states: grey when something it needs is still outstanding, amber when it can be done now, and struck through in green once it is done.">
      <Swatch label="not yet" bg={colors.card} border={colors.border} color={colors.foreground} colors={colors} />
      <Swatch label="do this now" bg={colors.warmBg} border={colors.warmLine} color={colors.warmInk} colors={colors} ring />
      <Swatch label="done" bg={done} border={colors.border} color={colors.coolInk} colors={colors} struck />
    </View>
  );
}

function Swatch({
  label,
  bg,
  border,
  color,
  ring,
  struck,
}: {
  label: string;
  bg: string;
  border: string;
  color: string;
  colors: Colors;
  ring?: boolean;
  struck?: boolean;
}) {
  return (
    <View style={[styles.swatch, { backgroundColor: bg, borderColor: border, borderWidth: ring ? 2 : 1 }]}>
      <Text style={[styles.swatchText, { color, fontWeight: ring ? '600' : '500' }, struck && styles.struck]}>
        {struck ? '✓ ' : ''}
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  coach: { minHeight: 20, marginBottom: 8 },
  coachText: { fontSize: 13.5, lineHeight: 19 },
  tipSlot: { minHeight: 34, marginBottom: 6 },
  tip: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 11 },
  tipText: { fontSize: 12.5, lineHeight: 18 },
  tag: { borderWidth: 1, borderRadius: 99, paddingVertical: 2, paddingHorizontal: 9 },
  tagText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.95, lineHeight: 15 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 },
  swatch: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  swatchText: { fontSize: 11.5 },
  struck: { textDecorationLine: 'line-through', opacity: 0.7 },
});
