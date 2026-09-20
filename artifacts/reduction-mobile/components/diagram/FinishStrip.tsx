/**
 * components/diagram/FinishStrip.tsx — the tail of a recipe, as a list.
 *
 * The web's `.rd-finish` ported: the steps shared/collapse.ts pulls out of
 * the table — bake, chill, slice — one row each, numbered, with their
 * minutes, in cooking order. A row is a step like any other: it toggles,
 * it opens the step sheet in edit mode, and it takes a drop from the drag
 * (SectionDiagram measures the rows it is handed refs for). Leaving the
 * tail out of editing would make "bake" the one step you cannot fix.
 *
 * `focus` (the web's `.is-focus`, once the tree part is done) changes
 * colour only. CLAUDE.md: nothing may resize under a fingertip, and the
 * strip is exactly what the finger reaches for after the handoff tap.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Step } from "@/shared/layout";
import { formatMinutes } from "@/shared/amounts";
import { tailStepReady } from "@/shared/collapse";
import type { Colors } from "@/hooks/useColors";

export type StripDrop = "ok" | "over" | "no" | null;

interface Props {
  tail: Step[];
  done: Set<string>;
  focus: boolean;
  colors: Colors;
  onPress: (id: string) => void;
  dropFor: (id: string) => StripDrop;
  /** Handed each row's View so the drag can measure it at pickup. */
  rowRef: (id: string) => (v: View | null) => void;
  editing: boolean;
}

export function FinishStrip({ tail, done, focus, colors, onPress, dropFor, rowRef, editing }: Props) {
  if (!tail.length) return null;
  return (
    <View style={styles.strip} testID="finish-strip">
      {tail.map((n, i) => {
        const isDone = done.has(n.id);
        const ready = !isDone && tailStepReady(n, done);
        const drop = dropFor(n.id);
        const mins = formatMinutes(n.minutes);
        const bg = drop === "over" ? colors.coolBg : isDone ? colors.coolBg : ready ? colors.warmBg : colors.card;
        const line = isDone ? colors.coolLine : ready ? colors.warmLine : colors.border;
        const ink = isDone ? colors.coolInk : ready ? colors.warmInk : colors.text;
        return (
          <View key={n.id} style={styles.item}>
            {i > 0 ? <View style={[styles.link, { backgroundColor: colors.borderStrong }]} /> : null}
            <View ref={rowRef(n.id)} collapsable={false}>
              <Pressable
                onPress={() => onPress(n.id)}
                testID={`fin-${n.id}`}
                {...(editing
                  ? { accessibilityRole: "button" as const, accessibilityLabel: `Edit "${n.label}"` }
                  : {
                      accessibilityRole: "togglebutton" as const,
                      accessibilityLabel: `${i + 1}. ${n.label}${mins ? `, ${mins}` : ""}, ${isDone ? "done" : ready ? "ready" : "not yet"}`,
                      "aria-checked": isDone,
                      accessibilityHint: isDone ? `Undoes ${n.label}` : ready ? `Marks ${n.label} done` : `Marks ${n.label} done, along with every step before it`,
                    })}
                style={[
                  styles.row,
                  { backgroundColor: bg, borderColor: drop === "over" ? colors.coolInk : line },
                  ready ? { borderWidth: 2 } : null,
                  drop === "ok" ? { borderColor: colors.coolLine, borderWidth: 2 } : null,
                  drop === "over" ? { borderWidth: 3 } : null,
                  drop === "no" ? { opacity: 0.35 } : null,
                  focus && !editing ? { opacity: 1 } : null,
                ]}
              >
                <View style={[styles.num, { borderColor: line }]}>
                  <Text style={[styles.numText, { color: isDone || ready ? ink : colors.faint }]}>{i + 1}</Text>
                </View>
                <Text
                  style={[
                    styles.label,
                    { color: ink, fontWeight: ready ? "600" : "500" },
                    isDone ? styles.struck : null,
                  ]}
                >
                  {n.label}
                </Text>
                {mins ? <Text style={[styles.time, { color: isDone ? colors.coolInk : colors.mutedForeground }]}>{mins}</Text> : null}
                {isDone ? <Text style={[styles.mark, { color: colors.coolInk }]}>✓</Text> : null}
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // .rd-finish at ≤700px: a column, one row per step, a short vertical
  // link between them at the number's x.
  strip: { marginTop: 12 },
  item: {},
  link: { width: 1, height: 12, marginVertical: 3, marginLeft: 26 },
  // .rd-fin: card, hairline, 12px radius, 11/14 padding — 44px+ tall.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  num: {
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  numText: { fontFamily: "SpaceMono_400Regular", fontSize: 10 },
  label: { flex: 1, fontSize: 14, lineHeight: 17.5 },
  struck: { textDecorationLine: "line-through", opacity: 0.78 },
  time: { fontFamily: "SpaceMono_400Regular", fontSize: 10.5 },
  mark: { fontSize: 11, fontWeight: "700" },
});
