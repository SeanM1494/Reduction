/**
 * components/demo/DemoCoach.tsx — the demo's autoplay, its legend and its
 * tag. The teaching itself is the guided demo (lib/demoGuide.ts and
 * GuideCard.tsx, Sep 29), which replaced the coach line and the two tips
 * that used to live here: they relied on small text.
 *   CoachLegend     the three cell states, as swatches in the diagram's tokens
 *   useWatchPlayer  the autoplay behind "Watch instead"
 *
 * This layer wraps RecipeScreen — it never reaches into it. No testIDs, no
 * anchoring to a cell, no imports from layout.ts. Everything here is derived
 * from the recipe's own graph and the `done` set, so a DiagramView refactor
 * cannot break the coaching (CLAUDE.md, "The demo teaches through a wrapper,
 * not a fork").
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
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

// The autoplay order lives with the guide (lib/demoGuide.ts), pure and tested.
export { watchOrder } from '@/lib/demoGuide';

// ---------------------------------------------------------------- watch ----

/** Autoplay for "Watch it". Always replays from the opening position; any
 *  interaction stops it mid-run and leaves the progress it made in place. */
export function useWatchPlayer(
  order: string[],
  prechecked: string[],
  setDone: (next: string[]) => void,
  /** Called when a run plays to its end (not when it is stopped). */
  onEnd?: () => void
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
      onEnd?.();
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
        onEnd?.();
      }, at + WATCH_NARRATED_MS)
    );
  }, [order, prechecked, setDone, stop, onEnd]);

  return { playing, line, play, stop };
}

// --------------------------------------------------------------- pieces ----

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
  tag: { borderWidth: 1, borderRadius: 99, paddingVertical: 2, paddingHorizontal: 9 },
  tagText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.95, lineHeight: 15 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 },
  swatch: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  swatchText: { fontSize: 11.5 },
  struck: { textDecorationLine: 'line-through', opacity: 0.7 },
});
