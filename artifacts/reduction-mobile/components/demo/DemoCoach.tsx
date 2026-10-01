/**
 * components/demo/DemoCoach.tsx — the demo's autoplay, its legend and its
 * tag. The teaching itself is the guided demo (lib/demoGuide.ts and
 * GuideCard.tsx, Sep 29), which replaced the coach line and the two tips
 * that used to live here: they relied on small text. "Watch instead" is
 * the guide played by itself (lib/demoWatch.ts, Oct 1), which replaced the
 * narrated autoplay that lived here.
 *   CoachLegend     the three cell states, as swatches in the diagram's tokens
 *
 * This layer wraps RecipeScreen — it never reaches into it. No testIDs, no
 * anchoring to a cell, no imports from layout.ts. Everything here is derived
 * from the recipe's own graph and the `done` set, so a DiagramView refactor
 * cannot break the coaching (CLAUDE.md, "The demo teaches through a wrapper,
 * not a fork").
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { doneBackground } from '@/components/diagram/DiagramView';

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
