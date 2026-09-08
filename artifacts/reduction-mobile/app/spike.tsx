/**
 * app/spike.tsx — Phase 0: the diagram spike, fixture-fed.
 *
 * Not a product screen. This exists to answer the kill criteria before any
 * real screen is built on the renderer:
 *   1. structural identity with computeLayout   — layoutRects.test.ts (node)
 *   2. 60fps scroll on a real device, 30 steps  — the FPS meter + shake →
 *                                                 perf monitor, on THIS screen
 *   3. sticky column pixel-aligned at any scroll — the overlay never moves,
 *                                                 verified by eye here and by
 *                                                 rect assertions in the web
 *                                                 export sweep
 *   4. tap-to-done round-trips                   — tap any op cell
 *
 * Reachable WITHOUT sign-in (see the pass-through in _layout.tsx): it is
 * fixture-fed and talks to no API — and the first-run decision (demo before
 * sign-in) will generalize that pass-through in Phase 1 anyway.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DiagramView } from "@/components/diagram/DiagramView";
import { FpsMeter } from "@/components/diagram/FpsMeter";
import { STRESS_RECIPE } from "@/components/diagram/stressFixture";
import { DEMO_RECIPE } from "@/data/demoRecipe";
import { useColors } from "@/hooks/useColors";

const FIXTURES = [
  { name: "Guacamole (demo)", recipe: DEMO_RECIPE },
  { name: "Stress: 30 steps", recipe: STRESS_RECIPE },
] as const;

export default function SpikeScreen() {
  const colors = useColors();
  const [which, setWhich] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const recipe = FIXTURES[which].recipe;

  const toggle = useMemo(
    () => (stepId: string) =>
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next;
      }),
    []
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} testID="spike-screen">
      <FpsMeter />
      <View style={styles.bar}>
        {FIXTURES.map((f, i) => (
          <Pressable
            key={f.name}
            testID={`fixture-${i}`}
            onPress={() => {
              setWhich(i);
              setDone(new Set());
            }}
            style={[
              styles.tab,
              { borderColor: colors.border },
              i === which && { backgroundColor: colors.muted },
            ]}
          >
            <Text style={{ color: colors.text, fontSize: 13 }}>{f.name}</Text>
          </Pressable>
        ))}
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginLeft: "auto" }}>
          done: {done.size}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 4 }}>
        <DiagramView recipe={recipe} done={done} onToggle={toggle} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  tab: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 44,
    justifyContent: "center",
  },
});
