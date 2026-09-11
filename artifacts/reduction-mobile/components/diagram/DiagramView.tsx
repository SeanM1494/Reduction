/**
 * components/diagram/DiagramView.tsx — the second renderer of computeLayout.
 *
 * Geometry comes entirely from layoutRects.ts; this component contributes the
 * two things the browser's table engine used to donate and nothing else:
 *
 * MEASURE, THEN PLACE. Pass 1 renders every cell's content invisibly at its
 * final width and collects natural heights via onLayout; when the last one
 * reports, solveRowHeights turns them into row heights and pass 2 renders the
 * same cells absolutely positioned. The pass-1 tree stays mounted and hidden
 * so a cell whose content changes re-reports and the grid re-solves — heights
 * are state derived from content, not a one-shot.
 *
 * STICKY WITHOUT ANIMATION. The ingredient column (col 0) is painted twice:
 * once inside the horizontal scroller (it owns the layout space) and once in
 * a static overlay OUTSIDE the scroller at left: 0. Nothing translates on
 * scroll — the overlay simply never moves, which cannot jank, cannot drift,
 * and needs no scroll listener on any thread. The overlay copy is the
 * tappable one (it is on top); rows align by construction because both trees
 * use the same solved offsets. A hairline elevation shadow fades in via one
 * native-driver Animated.Event as the only scroll-coupled effect, and it is
 * cosmetic.
 *
 * THE VISUAL LANGUAGE IS THE WEB DIAGRAM'S, TOKEN FOR TOKEN. Cell borders in
 * `border` on a `card` ground, the frame in `borderStrong` with a 14px radius
 * and a shadow, the ingredient column tinted `muted` with a 3px strong rule
 * down its left edge, a 2px strong rule across the first row of a branch,
 * "ready" (a step whose every input is done) in warm fill + warm ring + a
 * slow pulsing halo, "done" in a cool tint with a checkmark and struck text.
 * The first version drew hairlines in `border` directly on the page — which
 * is within a shade of the page — and painted ingredient cells in the page
 * colour, so on a phone the grid had no outlines and the sticky column was
 * loose text. Every value here has a named counterpart in index.css; if one
 * changes there, change it here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { Recipe, Section, Cell } from "@/shared/layout";
import { computeLayout } from "@/shared/layout";
import { formatAmount } from "@/shared/amounts";
import { useColors, type Colors } from "@/hooks/useColors";
import {
  diagramRects,
  type DiagramMetrics,
  colWidth,
} from "./layoutRects";

export const METRICS: DiagramMetrics = {
  // The web app constrains .rd-ing to 84-120px; 120 is its roomy end.
  ingColWidth: 120,
  opColWidth: 104,
  minRowHeight: 44, // the touch-target floor, not a style choice
  colGap: 0,
};

const CELL_PAD_V = 7; // .rd-cell: padding 7px 8px
const CELL_PAD_H = 8;
const ING_RULE = 3; // .rd-ing: inset 3px 0 0 var(--line-strong)
const BRANCH_RULE = 2; // .rd-starts-branch: border-top 2px
const PULSE_MS = 2400; // rd-pulse: 2.4s ease-in-out infinite

/**
 * color-mix(in srgb, a W%, b) for two hex colours. The dark theme's cool and
 * warm tokens are rgba with their own transparency and composite correctly
 * over the card on their own, so anything that is not plain hex is returned
 * as it is.
 */
function mix(a: string, b: string, weightA: number): string {
  const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  if (!hex(a) || !hex(b)) return a;
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) =>
    Math.round(ch(a, i) * weightA + ch(b, i) * (1 - weightA))
      .toString(16)
      .padStart(2, "0")
  );
  return `#${out.join("")}`;
}

interface CellState {
  isDone: boolean;
  /** Steps only: every input done and itself not — the diagram's "do this
   *  next" signal, derived exactly as Diagram.tsx derives it. */
  ready: boolean;
  /** Gaps only: gaps belong to the step on their right and shade with it. */
  ownerDone: boolean;
}

function stateOf(c: Cell, done: Set<string>): CellState {
  if (c.kind === "gap") {
    return { isDone: false, ready: false, ownerDone: !!c.owner && done.has(c.owner) };
  }
  const isDone = done.has(c.key);
  const ready =
    !isDone &&
    (c.kind === "op" || c.kind === "collapsed") &&
    (c.inputs ?? []).every((i) => done.has(i));
  return { isDone, ready, ownerDone: false };
}

interface SectionDiagramProps {
  section: Section;
  done: Set<string>;
  onToggle: (id: string) => void;
  scale?: number;
}

function cellContent(
  c: Cell,
  scale: number,
  colors: Colors,
  st: CellState,
  measuring: boolean
) {
  // Gap cells are the layout's whitespace — the web paints them as empty
  // rd-gap tds. Nothing to render; the Pressable shell paints background.
  if (c.kind === "gap") return null;
  const struck = st.isDone ? styles.struck : null;
  if (c.kind === "ingredient" && c.ingredient) {
    return (
      <View style={styles.ingBody}>
        <Text style={[styles.amount, { color: st.isDone ? colors.coolInk : colors.mutedForeground }]}>
          {formatAmount(c.ingredient, scale)}
        </Text>
        <Text style={[styles.name, { color: st.isDone ? colors.coolInk : colors.text }, struck]}>
          {c.ingredient.name}
        </Text>
        {c.ingredient.note ? (
          <Text style={[styles.note, { color: colors.faint }, struck]}>{c.ingredient.note}</Text>
        ) : null}
      </View>
    );
  }
  const label = c.text ?? "";
  // Measure at the ready weight (600): it is the widest a label gets, so a
  // step becoming ready can never overflow the height it was measured at.
  const weight = measuring || st.ready ? "600" : "500";
  const color = st.isDone ? colors.coolInk : st.ready ? colors.warmInk : colors.text;
  return (
    <Text style={[styles.opLabel, { color, fontWeight: weight }, struck]}>
      {label}
      {c.kind === "collapsed" && c.itemCount ? `  (${c.itemCount})` : ""}
    </Text>
  );
}

/** .rd-cell.is-done: color-mix(in srgb, var(--cool-bg) 52%, var(--card)).
 *  Exported so the demo's legend paints "done" with the same value. */
export const doneBackground = (colors: Colors): string => mix(colors.coolBg, colors.card, 0.52);

export function SectionDiagram({ section, done, onToggle, scale = 1 }: SectionDiagramProps) {
  const colors = useColors();
  const layout = useMemo(() => computeLayout(section), [section]);
  const cells = useMemo(() => layout.rows.flat(), [layout]);
  const doneBg = useMemo(() => doneBackground(colors), [colors]);

  // key -> measured natural height. A plain object in a ref plus a version
  // counter, so one hundred onLayout callbacks cause one hundred cheap ref
  // writes and at most a handful of re-solves.
  const heightsRef = useRef(new Map<string, number>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const pending = useRef(new Set(cells.map((c) => c.key)));

  const onMeasure = useCallback((key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + CELL_PAD_V * 2;
    const prev = heightsRef.current.get(key);
    if (prev !== h) {
      heightsRef.current.set(key, h);
      pending.current.delete(key);
      if (pending.current.size === 0) setMeasuredVersion((v) => v + 1);
    } else {
      pending.current.delete(key);
      if (pending.current.size === 0) setMeasuredVersion((v) => v + 1);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(
    () => diagramRects(layout, heightsRef.current, METRICS),
    [layout, measuredVersion]
  );
  const placed = measuredVersion > 0;

  const scrollX = useRef(new Animated.Value(0)).current;
  const stickyShadow = scrollX.interpolate({
    inputRange: [0, 12],
    outputRange: [0, 0.18],
    extrapolate: "clamp",
  });

  // The ready halo: one value shared by every ready cell, opacity only (never
  // a transform inside the scroller — see CLAUDE.md), native driver, and
  // held still for anyone who asked the OS for reduced motion.
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 0.1, duration: PULSE_MS / 2, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0.55, duration: PULSE_MS / 2, useNativeDriver: true }),
          ])
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  const renderCell = (c: Cell, opts: { measuring?: boolean; overlay?: boolean } = {}) => {
    const rect = opts.measuring
      ? null
      : geometry.rects.find((r) => r.cell.key === c.key)!;
    const st = stateOf(c, done);
    const tappable = c.kind !== "gap";
    if (opts.measuring) {
      return (
        <View
          key={c.key}
          style={{
            position: "absolute",
            width:
              colWidth(c.col, c.colSpan, METRICS) -
              CELL_PAD_H * 2 -
              (c.kind === "ingredient" ? ING_RULE : 0),
            opacity: 0,
          }}
          pointerEvents="none"
        >
          <View onLayout={onMeasure(c.key)}>{cellContent(c, scale, colors, st, true)}</View>
        </View>
      );
    }
    const isIng = c.kind === "ingredient";
    const background =
      c.kind === "gap"
        ? st.ownerDone
          ? colors.coolBg
          : colors.card
        : isIng
          ? st.isDone
            ? doneBg
            : colors.muted
          : st.isDone
            ? doneBg
            : st.ready
              ? colors.warmBg
              : colors.card;
    return (
      <Pressable
        key={c.key}
        testID={`cell-${c.kind}-${c.key}`}
        disabled={!tappable}
        onPress={tappable ? () => onToggle(c.key) : undefined}
        style={{
          position: "absolute",
          left: rect!.x,
          top: rect!.y,
          width: rect!.width,
          height: rect!.height,
          paddingVertical: CELL_PAD_V,
          paddingHorizontal: CELL_PAD_H,
          justifyContent: "center",
          backgroundColor: background,
          borderColor: colors.border,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          // The first row of a branch that merges with a sibling gets a
          // heavier top rule, so the merge reads as a boundary.
          borderTopWidth: c.startsBranch ? BRANCH_RULE : 0,
          borderTopColor: colors.borderStrong,
          // The ingredient column's rule: strong by default, cool when done.
          borderLeftWidth: isIng ? ING_RULE : 0,
          borderLeftColor: st.isDone ? colors.coolLine : colors.borderStrong,
        }}
      >
        {cellContent(c, scale, colors, st, false)}
        {st.ready ? (
          <>
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: colors.warmLine }]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                { borderColor: colors.warmLine, opacity: pulse },
              ]}
            />
          </>
        ) : null}
        {st.isDone && c.kind !== "gap" ? (
          <Text style={[styles.mark, { color: colors.coolInk }]}>✓</Text>
        ) : null}
      </Pressable>
    );
  };

  const stickyCells = cells.filter((c) => c.col === 0);
  const bodyH = placed ? geometry.totalHeight : METRICS.minRowHeight * layout.totalRows;

  return (
    // Two views because iOS drops a shadow from any view that clips: the
    // outer one casts, the inner one clips to the radius.
    <View style={styles.frameShadow}>
      <View style={[styles.frame, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}>
        <View style={{ height: bodyH }}>
          {/* Pass 1: the invisible measuring tree. Stays mounted so content
              changes re-measure; costs nothing visible. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {cells.map((c) => renderCell(c, { measuring: true }))}
          </View>

          {placed ? (
            <>
              <Animated.ScrollView
                horizontal
                bounces={false}
                showsHorizontalScrollIndicator
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                  { useNativeDriver: true }
                )}
                scrollEventThrottle={16}
                contentContainerStyle={{ width: geometry.totalWidth, height: bodyH }}
              >
                {cells.map((c) => renderCell(c))}
              </Animated.ScrollView>

              {/* The sticky ingredient column: a static overlay. It never moves,
                  so it can never jank. */}
              <View
                pointerEvents="box-none"
                style={[StyleSheet.absoluteFill, { width: METRICS.ingColWidth }]}
              >
                {stickyCells.map((c) => renderCell(c, { overlay: true }))}
                {/* --pin: the column's soft shadow onto the scrolled content,
                    fading in with the first pixels of scroll. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      left: METRICS.ingColWidth,
                      width: 8,
                      backgroundColor: colors.text,
                      opacity: stickyShadow,
                    },
                  ]}
                />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

interface DiagramViewProps {
  recipe: Recipe;
  done: Set<string>;
  onToggle: (id: string) => void;
  scale?: number;
}

/** All sections, stacked — the web app renders one table per section. */
export function DiagramView({ recipe, done, onToggle, scale }: DiagramViewProps) {
  const colors = useColors();
  return (
    <View>
      {recipe.sections.map((s, i) => (
        <View key={`${s.name}-${i}`} style={{ marginBottom: 24 }}>
          {recipe.sections.length > 1 ? (
            <Text style={[styles.sectionName, { color: colors.text }]}>{s.name}</Text>
          ) : null}
          <SectionDiagram section={s} done={done} onToggle={onToggle} scale={scale} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frameShadow: {
    shadowColor: "#3a2418",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  frame: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  ingBody: { gap: 3 },
  amount: { fontFamily: "SpaceMono_400Regular", fontSize: 13, letterSpacing: -0.13 },
  name: { fontSize: 14, lineHeight: 17.5 },
  note: { fontSize: 12.5, lineHeight: 15, fontStyle: "italic" },
  opLabel: { fontSize: 14, lineHeight: 18, textAlign: "center" },
  struck: { textDecorationLine: "line-through", opacity: 0.58 },
  // The halo sits 3px outside the ring (0 0 0 3px in the web's box-shadow)
  // and breathes; the frame clips it at the table's edge, as the web does.
  halo: { position: "absolute", top: -3, left: -3, right: -3, bottom: -3, borderWidth: 3 },
  mark: { position: "absolute", top: 3, right: 6, fontSize: 11, fontWeight: "700" },
  sectionName: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
});
