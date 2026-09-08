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
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
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

const CELL_PAD_V = 6;
const CELL_PAD_H = 8;

interface SectionDiagramProps {
  section: Section;
  done: Set<string>;
  onToggle: (stepId: string) => void;
  scale?: number;
}

function cellContent(c: Cell, scale: number, colors: Colors, done: boolean) {
  // Gap cells are the layout's whitespace — the web paints them as empty
  // rd-gap tds. Nothing to render; the Pressable shell paints background.
  if (c.kind === "gap") return null;
  if (c.kind === "ingredient" && c.ingredient) {
    return (
      <View>
        <Text
          style={[styles.amount, { color: colors.mutedForeground }, done && styles.doneText]}
        >
          {formatAmount(c.ingredient, scale)}
        </Text>
        <Text style={[styles.name, { color: colors.text }, done && styles.doneText]}>
          {c.ingredient.name}
        </Text>
      </View>
    );
  }
  const label = c.text ?? "";
  return (
    <Text style={[styles.opLabel, { color: colors.text }, done && styles.doneText]}>
      {label}
      {c.kind === "collapsed" && c.itemCount ? `  (${c.itemCount})` : ""}
    </Text>
  );
}

export function SectionDiagram({ section, done, onToggle, scale = 1 }: SectionDiagramProps) {
  const colors = useColors();
  const layout = useMemo(() => computeLayout(section), [section]);
  const cells = useMemo(() => layout.rows.flat(), [layout]);

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

  const renderCell = (c: Cell, opts: { measuring?: boolean; overlay?: boolean } = {}) => {
    const rect = opts.measuring
      ? null
      : geometry.rects.find((r) => r.cell.key === c.key)!;
    const isDone = (c.kind === "op" || c.kind === "collapsed") && done.has(c.key);
    const tappable = c.kind === "op" || c.kind === "collapsed";
    const body = (
      <View
        style={opts.measuring ? { paddingHorizontal: 0 } : undefined}
        onLayout={opts.measuring ? onMeasure(c.key) : undefined}
      >
        {cellContent(c, scale, colors, isDone)}
      </View>
    );
    if (opts.measuring) {
      return (
        <View
          key={c.key}
          style={{
            position: "absolute",
            width: colWidth(c.col, c.colSpan, METRICS) - CELL_PAD_H * 2,
            opacity: 0,
          }}
          pointerEvents="none"
        >
          {body}
        </View>
      );
    }
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
          borderColor: colors.border,
          backgroundColor:
            c.kind === "gap"
              ? colors.background
              : c.kind === "ingredient"
                ? colors.background
                : isDone
                  ? colors.muted
                  : colors.card,
          borderBottomWidth: c.kind === "gap" ? 0 : StyleSheet.hairlineWidth,
          borderRightWidth: c.kind === "gap" ? 0 : StyleSheet.hairlineWidth,
          opacity: isDone ? 0.55 : 1,
        }}
      >
        {cellContent(c, scale, colors, isDone)}
      </Pressable>
    );
  };

  const stickyCells = cells.filter((c) => c.col === 0);
  const bodyH = placed ? geometry.totalHeight : METRICS.minRowHeight * layout.totalRows;

  return (
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
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: colors.text,
                  opacity: stickyShadow,
                  transform: [{ translateX: METRICS.ingColWidth }],
                  width: 6,
                },
              ]}
            />
            {stickyCells.map((c) => renderCell(c, { overlay: true }))}
          </View>
        </>
      ) : null}
    </View>
  );
}

interface DiagramViewProps {
  recipe: Recipe;
  done: Set<string>;
  onToggle: (stepId: string) => void;
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
  amount: { fontFamily: "SpaceMono_400Regular", fontSize: 12.5 },
  name: { fontSize: 14, lineHeight: 18 },
  opLabel: { fontSize: 14, lineHeight: 18, fontWeight: "500" },
  doneText: { textDecorationLine: "line-through" },
  sectionName: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
});
