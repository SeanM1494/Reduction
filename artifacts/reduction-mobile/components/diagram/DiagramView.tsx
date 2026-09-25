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
 *
 * THE DRAG (edit mode): press and hold an ingredient in the sticky column
 * and it lifts; the steps it may legally move to light up from the
 * validator's own answer (validMoveTargets — never a re-derived predicate),
 * a ghost of its name follows the finger, and the lit step under the
 * finger at release takes the drop. gesture-handler's Pan activated after
 * a long press keeps a tap a tap and a swipe a scroll. Hit-testing is
 * arithmetic against the solved rects (dragMath.ts): the finger's window
 * point, the frame's window origin measured once at pickup, and the
 * scroller's offset. Nothing in the grid moves during the drag. Both
 * scrollers — the frame's and the page's — scroll themselves while the
 * finger loiters near an edge, because on a phone the next step down is
 * off screen the moment an ingredient is centred (measured on the web on an
 * iPhone SE; same geometry here).
 * The first version drew hairlines in `border` directly on the page — which
 * is within a shade of the page — and painted ingredient cells in the page
 * colour, so on a phone the grid had no outlines and the sticky column was
 * loose text. Every value here has a named counterpart in index.css; if one
 * changes there, change it here.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { Recipe, Section, Cell } from "@/shared/layout";
import { deriveDiagramState } from "@/shared/collapse";
import { computeLayout } from "@/shared/layout";
import { formatAmount } from "@/shared/amounts";
import { noTargetsReason, validMoveTargets } from "@/shared/edits";
import { edgeDir, rectAt, stepAt, toContent, type WindowRect } from "./dragMath";
import { FinishStrip, type StripDrop } from "./FinishStrip";
import { useColors, type Colors } from "@/hooks/useColors";
import {
  diagramRects,
  type DiagramMetrics,
  type CellRect,
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

/** The hold before an ingredient lifts. The web's useIngredientDrag chose
 *  350ms: between the ~250ms of touch drag-and-drop conventions and the
 *  500ms of a system long-press, nearer the former because this is the
 *  primary way to move something. A cell here is also a tap target (it
 *  opens the sheet), so the hold has to be clearly longer than a slow tap. */
export const HOLD_MS = 350;
/** How near the frame's side the finger gets before the frame scrolls
 *  itself, and how near the window's top or bottom before the page does. */
const EDGE_PX = 44;
const PAGE_EDGE_PX = 56;
const EDGE_STEP_PX = 10;
const EDGE_TICK_MS = 16;
/** The ghost sits under the fingertip, not on it (the web's -22/-18). */
const GHOST_OFFSET_X = 22;
const GHOST_OFFSET_Y = 18;
const GHOST_WIDTH = 150;
const EMPTY_TARGETS: ReadonlySet<string> = new Set();

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

/**
 * Edit mode: a tap opens a sheet instead of marking done, and the frame says
 * so with a cool outline — tapping a cell means "mark done" everywhere else,
 * so the mode must never be quiet (CLAUDE.md, "Edit mode must never be
 * quiet"). Press and hold an ingredient to move it (see the header); the
 * sheet's "Used in" list remains the move for anyone who cannot drag.
 */
export interface DiagramEdit {
  onTapCell: (id: string) => void;
  onTapSection: (index: number) => void;
  /** The drop: the screen applies a moveIngredient op through its own
   *  validate-undo-write path, the same as a sheet's "Used in" choice. */
  onMove: (ingredientId: string, toStepId: string) => void;
  /** A pickup that found nowhere legal to go, phrased for a person. */
  onBlocked: (reason: string) => void;
  /** The page must not scroll under a live drag: the screen turns its
   *  scroller off for the duration. */
  onDragChange?: (dragging: boolean) => void;
  /** Scrolls the page by `dy` while the finger loiters near the window's
   *  top or bottom; returns how far it actually moved (0 at either end). */
  scrollPageBy?: (dy: number) => number;
}

/** What one section's drag needs, derived from DiagramEdit plus the recipe
 *  (targets are decided against the whole tree, which a section lacks). */
interface SectionDrag {
  targetsFor: (ingredientId: string) => string[];
  reasonFor: (ingredientId: string) => string | null;
  onMove: (ingredientId: string, toStepId: string) => void;
  onBlocked: (reason: string) => void;
  onDragChange: (dragging: boolean) => void;
  scrollPageBy?: (dy: number) => number;
}

/** A cell's part in a live drag. Steps are lit or dimmed from the
 *  validator's answer; the lifted ingredient fades where it was. */
type DropState = "lifted" | "ok" | "over" | "no" | null;

interface SectionDiagramProps {
  section: Section;
  done: Set<string>;
  onToggle: (id: string) => void;
  scale?: number;
  edit?: DiagramEdit | null;
  drag?: SectionDrag | null;
}

/** The width a cell's content wraps at: its column(s), less the padding
 *  and, for an ingredient, the rule down its left edge. */
const contentWidth = (cellWidth: number, kind: Cell["kind"]): number =>
  Math.max(0, cellWidth - CELL_PAD_H * 2 - (kind === "ingredient" ? ING_RULE : 0));

/**
 * A cell's content, at an EXPLICIT width (`w`), the same number in the
 * measuring pass and the drawn pass. The drawn pass also puts it in a box
 * with NO height (see DiagramCell): that, not the width, is what the
 * "thread onto v" report came down to.
 */
function cellContent(
  c: Cell,
  scale: number,
  colors: Colors,
  st: CellState,
  measuring: boolean,
  w: number
) {
  // Gap cells are the layout's whitespace — the web paints them as empty
  // rd-gap tds. Nothing to render; the Pressable shell paints background.
  if (c.kind === "gap") return null;
  const struck = st.isDone ? styles.struck : null;
  if (c.kind === "ingredient" && c.ingredient) {
    return (
      <View style={[styles.ingBody, { width: w }]}>
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
  if (c.kind === "collapsed") {
    // A fixed word, the same for every chip. The step's own label wrapped or
    // clipped mid-word in a 120px column on a real recipe ("cool complet…"),
    // and a chip is not that step any more — it is the whole branch, done.
    // What it folds is still in the accessibility label (cellAccessibility).
    return (
      <View style={[styles.chipBody, { width: w }]}>
        <Text style={[styles.chipMark, { color: colors.coolInk }]}>✓</Text>
        <Text style={[styles.opLabel, { color: colors.coolInk, fontWeight: "600" }]}>Combined</Text>
      </View>
    );
  }
  const label = c.text ?? "";
  // Measure at the ready weight (600): it is the widest a label gets, so a
  // step becoming ready can never overflow the height it was measured at.
  const weight = measuring || st.ready ? "600" : "500";
  const color = st.isDone ? colors.coolInk : st.ready ? colors.warmInk : colors.text;
  return (
    <Text style={[styles.opLabel, { width: w, color, fontWeight: weight }, struck]}>
      {label}
    </Text>
  );
}

/**
 * What a cell says to a screen reader — the web's `title` and `aria-pressed`
 * (RecipeView's `interaction`), as RN accessibility props. A cooking cell is
 * a toggle button whose checked state is "done"; a collapsed chip is a
 * button that expands; in edit mode every cell is a plain button that opens
 * fields. Gaps say nothing.
 */
function cellAccessibility(c: Cell, st: CellState, scale: number, editing: boolean) {
  if (c.kind === "gap") return {};
  if (c.kind === "collapsed") {
    return {
      accessibilityRole: "button" as const,
      accessibilityLabel: `Expand "${c.text ?? ""}" to show its ${c.itemCount ?? 0} ingredients and steps`,
      "aria-expanded": false,
    };
  }
  const name =
    c.kind === "ingredient" && c.ingredient
      ? `${formatAmount(c.ingredient, scale)} ${c.ingredient.name}${c.ingredient.note ? `, ${c.ingredient.note}` : ""}`.trim()
      : (c.text ?? "");
  if (editing) {
    return {
      accessibilityRole: "button" as const,
      accessibilityLabel: c.kind === "ingredient" ? `Edit ${name}, or press and hold to move it` : `Edit "${name}"`,
    };
  }
  const state = st.isDone ? "done" : st.ready ? "ready" : "not yet";
  return {
    accessibilityRole: "togglebutton" as const,
    accessibilityLabel: `${name}, ${state}`,
    "aria-checked": st.isDone,
    accessibilityHint: st.isDone
      ? `Undoes ${name} and everything after it`
      : st.ready
        ? `Marks ${name} done`
        : `Marks ${name} done, along with every step before it`,
  };
}

interface DiagramCellProps {
  cell: Cell;
  /** Null for the invisible measuring copy (pass 1). */
  rect: CellRect | null;
  isDone: boolean;
  ready: boolean;
  ownerDone: boolean;
  scale: number;
  colors: Colors;
  doneBg: string;
  pulse: Animated.Value;
  onToggle: (id: string) => void;
  onMeasure: ((key: string) => (e: LayoutChangeEvent) => void) | null;
  /** The drawn copy reports its content's height too (see DiagramCell). */
  onDrawn: ((key: string) => (e: LayoutChangeEvent) => void) | null;
  /** The content's measured height, to centre it in the cell; 0 until known. */
  contentH: number;
  drop: DropState;
  /** Edit mode: a tap opens fields, so the cell is a plain button. */
  editing: boolean;
  /** The scroller's copy of a column-0 cell sits under the sticky overlay's
   *  copy; only one of them may speak. */
  a11yHidden: boolean;
}

/**
 * One cell, memoised. The Phase 0 device read found that a tap re-rendered
 * every copy of every cell (540 renders per tap on the 30-step fixture,
 * measured in the RN-web build) because the cells were closures over the
 * section's `done` set. This component takes the three booleans `stateOf`
 * derives instead of the set, plus references that hold their identity
 * across renders — the layout's Cell, the solved rect, the memoised colour
 * object, the shared pulse value and a ref-backed toggle — so React's
 * shallow compare skips every cell whose state did not move.
 */
const DiagramCell = memo(function DiagramCell({
  cell: c,
  rect,
  isDone,
  ready,
  ownerDone,
  scale,
  colors,
  doneBg,
  pulse,
  onToggle,
  onMeasure,
  onDrawn,
  contentH,
  drop,
  editing,
  a11yHidden,
}: DiagramCellProps) {
  const st: CellState = { isDone, ready, ownerDone };
  const tappable = c.kind !== "gap";
  const a11y = cellAccessibility(c, st, scale, editing);
  if (onMeasure) {
    const w = contentWidth(colWidth(c.col, c.colSpan, METRICS), c.kind);
    return (
      <View style={{ position: "absolute", width: w, opacity: 0 }} pointerEvents="none">
        <View onLayout={onMeasure(c.key)}>{cellContent(c, scale, colors, st, true, w)}</View>
      </View>
    );
  }
  const isIng = c.kind === "ingredient";
  const background =
    c.kind === "gap"
      ? ownerDone
        ? colors.coolBg
        : colors.card
      : isIng
        ? isDone
          ? doneBg
          : colors.muted
        : isDone
          ? doneBg
          : ready
            ? colors.warmBg
            : colors.card;
  return (
    <Pressable
      testID={`cell-${c.kind}-${c.key}`}
      disabled={!tappable}
      onPress={tappable ? () => onToggle(c.key) : undefined}
      accessible={tappable && !a11yHidden}
      aria-hidden={!tappable || a11yHidden}
      {...a11y}
      style={{
        position: "absolute",
        left: rect!.x,
        top: rect!.y,
        width: rect!.width,
        height: rect!.height,
        paddingVertical: CELL_PAD_V,
        paddingHorizontal: CELL_PAD_H,
        justifyContent: "center",
        // .is-drop-over paints the cool hover; .is-lifted / .is-drop-no fade.
        backgroundColor: drop === "over" ? colors.coolBg : background,
        opacity: drop === "lifted" ? 0.45 : drop === "no" ? 0.35 : 1,
        borderColor: colors.border,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        // The first row of a branch that merges with a sibling gets a
        // heavier top rule, so the merge reads as a boundary.
        borderTopWidth: c.startsBranch ? BRANCH_RULE : 0,
        borderTopColor: colors.borderStrong,
        // The ingredient column's rule: strong by default, cool when done.
        borderLeftWidth: isIng ? ING_RULE : 0,
        borderLeftColor: isDone ? colors.coolLine : colors.borderStrong,
      }}
    >
      {/* The content sits in an absolute box with no height, centred by
          arithmetic rather than by justifyContent. Inside a box of definite
          height, Yoga measures a child text against that height (FitContent
          — CalculateLayout.cpp) and iOS lays out only the lines that fit,
          drawing the last one with NSLineBreakByClipping: a label taller
          than its row came out as ONE line cut mid-word, "thread onto v"
          (a real iPhone, Sep 24, twice). The browser never measures that
          way, which is why Chromium could not show it. With no height the
          text is measured whole, and its onLayout feeds the row solve, so a
          row can never end up shorter than what is drawn in it. */}
      <View
        pointerEvents="none"
        onLayout={onDrawn ? onDrawn(c.key) : undefined}
        style={{
          position: "absolute",
          left: CELL_PAD_H,
          top: Math.max(CELL_PAD_V, (rect!.height - (c.startsBranch ? BRANCH_RULE : 0) - contentH) / 2),
          width: contentWidth(rect!.width, c.kind),
        }}
      >
        {cellContent(c, scale, colors, st, false, contentWidth(rect!.width, c.kind))}
      </View>
      {ready ? (
        <>
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: colors.warmLine }]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.halo, { borderColor: colors.warmLine, opacity: pulse }]}
          />
          <ReadyMark colors={colors} />
        </>
      ) : null}
      {isDone && c.kind !== "gap" && c.kind !== "collapsed" ? (
        <Text style={[styles.mark, { color: colors.coolInk }]}>✓</Text>
      ) : null}
      {drop === "ok" || drop === "over" ? (
        /* .is-drop-ok: inset 2px cool-line; .is-drop-over: inset 3px cool-ink. */
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            drop === "over"
              ? { borderWidth: 3, borderColor: colors.coolInk }
              : { borderWidth: 2, borderColor: colors.coolLine },
          ]}
        />
      ) : null}
    </Pressable>
  );
});

/**
 * Colorblind mode's non-colour "ready" cue: the web's `.rd-op.is-ready
 * .rd-mark` triangle, top right, in the warm line colour. Colour alone
 * cannot carry "you can do this now" for someone who cannot tell the warm
 * ring from the cool one, so the shape does. Exported for the strip.
 */
export function ReadyMark({ colors, top = 7, right = 8 }: { colors: Colors; top?: number; right?: number }) {
  if (!colors.colorblind) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top,
        right,
        width: 0,
        height: 0,
        borderLeftWidth: 5,
        borderRightWidth: 5,
        borderBottomWidth: 9,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: colors.warmLine,
      }}
      testID="ready-mark"
    />
  );
}

/** .rd-cell.is-done: color-mix(in srgb, var(--cool-bg) 52%, var(--card)).
 *  Exported so the demo's legend paints "done" with the same value. */
export const doneBackground = (colors: Colors): string => mix(colors.coolBg, colors.card, 0.52);

export function SectionDiagram({ section, done, onToggle, scale = 1, edit = null, drag = null }: SectionDiagramProps) {
  const colors = useColors();
  const { height: windowH } = useWindowDimensions();
  // The finish strip, progressive collapse and the handoff are one pure
  // derivation shared with the web (shared/collapse.ts). This component
  // keeps only the two pieces of UI state it is fed: which chips the user
  // reopened, and whether the tucked table was asked for back. The override
  // only applies once the tree is finished, so unchecking anything brings
  // the diagram straight back with no stale state to reset.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [override, setOverride] = useState(false);
  const derived = useMemo(() => deriveDiagramState(section, done, expanded), [section, done, expanded]);
  const { tail, treeDone } = derived;
  const layout = derived.table;
  useEffect(() => {
    if (!__DEV__) return;
    const base = computeLayout(section);
    console.log(
      `[diagram] "${section.name}": table ${base.totalCols}→${layout.totalCols} cols, ${base.totalRows}→${layout.totalRows} rows;` +
        ` collapsed [${[...derived.collapsedIds].join(", ")}]; tail [${tail.map((n) => n.id).join(", ")}]; treeDone ${treeDone}` +
        `; not done: [${[...section.ingredients.map((i) => i.id), ...section.nodes.map((n) => n.id)].filter((id) => !done.has(id)).join(", ")}]`
    );
  }, [section, layout, derived.collapsedIds, tail, treeDone, done]);
  const showTable = treeDone ? override : true;
  const cells = useMemo(() => layout.rows.flat(), [layout]);
  const doneBg = useMemo(() => doneBackground(colors), [colors]);

  // key -> measured natural height. A plain object in a ref plus a version
  // counter, so one hundred onLayout callbacks cause one hundred cheap ref
  // writes and at most a handful of re-solves.
  const heightsRef = useRef(new Map<string, number>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const pending = useRef(new Set(cells.map((c) => c.key)));

  // What the DRAWN copy reports, kept apart so the two passes never
  // overwrite each other; the row solve takes the larger of the two.
  const drawnRef = useRef(new Map<string, number>());
  const onDrawn = useCallback((key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + CELL_PAD_V * 2;
    if (drawnRef.current.get(key) === h) return;
    drawnRef.current.set(key, h);
    setMeasuredVersion((v) => v + 1);
  }, []);

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

  // A table that has folded down to its first column alone — every branch
  // a chip — fills the frame's width, as the web's min-width table does,
  // rather than leaving two chips beside an empty card. The frame's inner
  // width comes from its own layout; until it is known the chips take the
  // column's usual width.
  const [frameInnerW, setFrameInnerW] = useState(0);
  const metrics = useMemo(
    () => (layout.totalCols === 1 && frameInnerW > METRICS.ingColWidth ? { ...METRICS, ingColWidth: frameInnerW } : METRICS),
    [layout.totalCols, frameInnerW]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const contentHeights = useMemo(() => {
    const m = new Map(heightsRef.current);
    for (const [k, h] of drawnRef.current) if (h > (m.get(k) ?? 0)) m.set(k, h);
    return m;
  }, [measuredVersion]);
  const geometry = useMemo(
    () => diagramRects(layout, contentHeights, metrics),
    [layout, metrics, contentHeights]
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

  // Each cell is a memoised component fed only primitives and stable
  // references, so a tap re-renders the cells whose STATE changed rather
  // than every copy of every cell (see DiagramCell).
  const rectByKey = useMemo(() => {
    const m = new Map<string, CellRect>();
    for (const r of geometry.rects) m.set(r.cell.key, r);
    return m;
  }, [geometry]);
  // In edit mode a tap opens the sheet; the ref keeps the cells' callback
  // identity stable across renders either way, which the memo depends on.
  // A tap that lands as the finger lifts off a drag is the drag's release,
  // not a request for the sheet, so taps are ignored for a beat after one.
  const onTapRef = useRef<(id: string) => void>(onToggle);
  onTapRef.current = edit ? edit.onTapCell : onToggle;
  const suppressTapUntil = useRef(0);
  const stableToggle = useCallback((id: string) => {
    if (Date.now() < suppressTapUntil.current) return;
    onTapRef.current(id);
  }, []);
  // A collapsed chip reopens its branch; it never toggles. Once reopened it
  // stays open for the life of this component — unchecking a step inside
  // also reopens it, since that step's parent chain gets un-done too.
  const stableExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ---- the drag ----------------------------------------------------------
  // Everything the gesture reads lives in refs: the callbacks run on the JS
  // thread out of the gesture's worklets, and must see the latest geometry
  // and config rather than the render they were created in.
  const dragRef = useRef<SectionDrag | null>(drag);
  dragRef.current = drag;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const bodyRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const hScroll = useRef(0);
  const frameWin = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const pageScrolled = useRef(0);
  const lastPoint = useRef({ x: 0, y: 0 });
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef<{ id: string; targets: Set<string> } | null>(null);
  // The finish strip's rows sit outside the scroller, so they are measured
  // in window space at pickup and hit-tested there (dragMath.rectAt).
  const stripViews = useRef(new Map<string, View>());
  const stripRects = useRef<WindowRect[]>([]);
  const stripRowRef = useCallback(
    (id: string) => (v: View | null) => {
      if (v) stripViews.current.set(id, v);
      else stripViews.current.delete(id);
    },
    []
  );
  /** The hold completed, whether or not anything lifted: a refused pickup
   *  is still a hold, and its release is not a tap either. */
  const held = useRef(false);
  const hoverRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [targets, setTargets] = useState<ReadonlySet<string>>(EMPTY_TARGETS);
  const [hover, setHover] = useState<string | null>(null);
  const [ghostLabel, setGhostLabel] = useState("");
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostOn = useSharedValue(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    hScroll.current = e.nativeEvent.contentOffset.x;
  };

  const place = (wx: number, wy: number) => {
    // Ghost space is the frame's: the frame rose by `pageScrolled` since
    // it was measured, so the same window point is that much further down.
    ghostX.value = wx - frameWin.current.x - GHOST_OFFSET_X;
    ghostY.value = wy - frameWin.current.y + pageScrolled.current - GHOST_OFFSET_Y;
  };
  const settle = (wx: number, wy: number) => {
    const d = live.current;
    if (!d) return;
    lastPoint.current = { x: wx, y: wy };
    place(wx, wy);
    const p = toContent(wx, wy, frameWin.current, hScroll.current, pageScrolled.current);
    const under = stepAt(geometryRef.current.rects, p.x, p.y) ?? rectAt(stripRects.current, wx, wy, pageScrolled.current);
    const next = under && d.targets.has(under) ? under : null;
    if (next !== hoverRef.current) {
      hoverRef.current = next;
      setHover(next);
      if (next) Haptics.selectionAsync().catch(() => {});
    }
  };
  const stopEdge = () => {
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  /** One loop drives both scrollers so they cannot fight each other. */
  const edgeScroll = (wx: number, wy: number) => {
    const f = frameWin.current;
    const hdir = edgeDir(wx, f.x, f.x + f.w, EDGE_PX);
    const vdir = dragRef.current?.scrollPageBy ? edgeDir(wy, 0, windowH, PAGE_EDGE_PX) : 0;
    if (hdir === 0 && vdir === 0) {
      stopEdge();
      return;
    }
    if (edgeTimer.current) return;
    edgeTimer.current = setInterval(() => {
      const g = geometryRef.current;
      if (hdir !== 0) {
        const max = Math.max(0, g.totalWidth - frameWin.current.w);
        const next = Math.min(max, Math.max(0, hScroll.current + hdir * EDGE_STEP_PX));
        if (next !== hScroll.current) {
          scrollRef.current?.scrollTo({ x: next, animated: false });
          hScroll.current = next;
        }
      }
      if (vdir !== 0) {
        const moved = dragRef.current?.scrollPageBy?.(vdir * EDGE_STEP_PX) ?? 0;
        pageScrolled.current += moved;
      }
      settle(lastPoint.current.x, lastPoint.current.y);
    }, EDGE_TICK_MS);
  };
  useEffect(() => stopEdge, []);

  const begin = (id: string, wx: number, wy: number) => {
    const d = dragRef.current;
    if (!d) return;
    held.current = true;
    const found = d.targetsFor(id);
    if (!found.length) {
      // Told before anything moves; the alternative — deleting the emptied
      // step — is a destructive reading of a drag.
      d.onBlocked(d.reasonFor(id) ?? "There is nowhere valid to move this.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    const name = rectByKey.get(id)?.cell.ingredient?.name ?? "ingredient";
    live.current = { id, targets: new Set(found) };
    hoverRef.current = null;
    pageScrolled.current = 0;
    lastPoint.current = { x: wx, y: wy };
    setDragging(id);
    setTargets(live.current.targets);
    setHover(null);
    setGhostLabel(name);
    d.onDragChange(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    AccessibilityInfo.announceForAccessibility(`Moving ${name}. Drop it on a highlighted step.`);
    bodyRef.current?.measureInWindow((x, y, w, h) => {
      frameWin.current = { x, y, w, h };
      place(wx, wy);
      ghostOn.value = 1;
    });
    stripRects.current = [];
    for (const [rowId, v] of stripViews.current) {
      v.measureInWindow((x, y, w, h) => {
        stripRects.current.push({ id: rowId, x, y, width: w, height: h });
      });
    }
  };
  const track = (wx: number, wy: number) => {
    if (!live.current) return;
    settle(wx, wy);
    edgeScroll(wx, wy);
  };
  const finish = (drop: boolean) => {
    stopEdge();
    const d = live.current;
    const target = hoverRef.current;
    live.current = null;
    hoverRef.current = null;
    ghostOn.value = 0;
    // A gesture that never held (a plain tap, whose Pan fails at release)
    // must not eat the tap that follows it; one that held must not open the
    // sheet as the finger lifts, whether it moved something or was refused.
    if (held.current) suppressTapUntil.current = Date.now() + 500;
    held.current = false;
    if (!d) return;
    setDragging(null);
    setTargets(EMPTY_TARGETS);
    setHover(null);
    dragRef.current?.onDragChange(false);
    if (drop && target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      dragRef.current?.onMove(d.id, target);
    }
  };
  // Edit mode ending under a live drag (a second finger on Done) must not
  // leave the page's scroller off or a ghost on screen.
  useEffect(() => {
    if (!drag && live.current) finish(false);
  });

  const gestureFor = (id: string) =>
    Gesture.Pan()
      .activateAfterLongPress(HOLD_MS)
      .onStart((e) => {
        runOnJS(begin)(id, e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        runOnJS(track)(e.absoluteX, e.absoluteY);
      })
      .onEnd(() => {
        runOnJS(finish)(true);
      })
      .onFinalize((_e, success) => {
        if (!success) runOnJS(finish)(false);
      });

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ghostX.value }, { translateY: ghostY.value }],
    opacity: ghostOn.value,
  }));

  const dropForStrip = (id: string): StripDrop => {
    if (!dragging) return null;
    if (hover === id) return "over";
    return targets.has(id) ? "ok" : "no";
  };

  const dropFor = (c: Cell): DropState => {
    if (!dragging) return null;
    if (c.key === dragging) return "lifted";
    if (c.kind !== "op" && c.kind !== "collapsed") return null;
    if (hover === c.key) return "over";
    return targets.has(c.key) ? "ok" : "no";
  };

  const renderCell = (c: Cell, opts: { measuring?: boolean; rect?: CellRect; a11yHidden?: boolean } = {}) => {
    const st = stateOf(c, done);
    return (
      <DiagramCell
        key={c.key}
        cell={c}
        rect={opts.measuring ? null : (opts.rect ?? rectByKey.get(c.key)!)}
        isDone={st.isDone}
        ready={st.ready}
        ownerDone={st.ownerDone}
        scale={scale}
        colors={colors}
        doneBg={doneBg}
        pulse={pulse}
        onToggle={c.kind === "collapsed" ? stableExpand : stableToggle}
        onMeasure={opts.measuring ? onMeasure : null}
        onDrawn={opts.measuring ? null : onDrawn}
        contentH={opts.measuring ? 0 : Math.max(0, (contentHeights.get(c.key) ?? 0) - CELL_PAD_V * 2)}
        drop={dropFor(c)}
        editing={!!edit}
        a11yHidden={!!opts.a11yHidden}
      />
    );
  };

  const stickyCells = cells.filter((c) => c.col === 0);
  // The gesture needs a host view to attach to, so in edit mode each sticky
  // ingredient sits in a View at its rect and the cell renders at the
  // View's origin. These rects are memoised so the cell's memo still holds.
  const originRects = useMemo(() => {
    const m = new Map<string, CellRect>();
    for (const r of geometry.rects) m.set(r.cell.key, { ...r, x: 0, y: 0 });
    return m;
  }, [geometry]);
  const renderSticky = (c: Cell) => {
    if (!drag || c.kind !== "ingredient") return renderCell(c);
    const r = rectByKey.get(c.key)!;
    return (
      <GestureDetector key={c.key} gesture={gestureFor(c.key)}>
        <View
          collapsable={false}
          style={{ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height }}
        >
          {renderCell(c, { rect: originRects.get(c.key)! })}
        </View>
      </GestureDetector>
    );
  };
  const bodyH = placed ? geometry.totalHeight : METRICS.minRowHeight * layout.totalRows;

  return (
    <View>
      {showTable ? (
    // Two views because iOS drops a shadow from any view that clips: the
    // outer one casts, the inner one clips to the radius. Lifted above the
    // strip while dragging so the ghost paints over it, not under it.
    <View style={[styles.frameShadow, dragging ? { zIndex: 2 } : null]}>
      <View style={[styles.frame, { borderColor: edit ? colors.coolLine : colors.borderStrong, borderWidth: edit ? 2 : 1, backgroundColor: colors.card }]}>
        <View
          ref={bodyRef}
          collapsable={false}
          style={{ height: bodyH }}
          onLayout={(e) => setFrameInnerW(Math.round(e.nativeEvent.layout.width))}
        >
          {/* Pass 1: the invisible measuring tree. Stays mounted so content
              changes re-measure; costs nothing visible. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden>
            {cells.map((c) => renderCell(c, { measuring: true }))}
          </View>

          {placed ? (
            <>
              <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                ref={scrollRef}
                horizontal
                bounces={false}
                scrollEnabled={!dragging}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                  { useNativeDriver: true, listener: onScroll }
                )}
                scrollEventThrottle={16}
                contentContainerStyle={{ width: geometry.totalWidth, height: bodyH }}
              >
                {cells.map((c) => renderCell(c, { a11yHidden: c.col === 0 }))}
              </Animated.ScrollView>

              {/* The sticky ingredient column: a static overlay. It never moves,
                  so it can never jank. */}
              <View
                pointerEvents="box-none"
                style={[StyleSheet.absoluteFill, { width: metrics.ingColWidth }]}
              >
                {stickyCells.map((c) => renderSticky(c))}
                {/* --pin: the column's soft shadow onto the scrolled content,
                    fading in with the first pixels of scroll. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      left: metrics.ingColWidth,
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
      {treeDone ? (
        /* .rd-tuck-btn: the handoff, by hand. */
        <Pressable
          accessibilityRole="button"
          onPress={() => setOverride(false)}
          style={styles.tuckBtn}
          testID="diagram-tuck"
        >
          <Text style={[styles.tuckText, { color: colors.mutedForeground }]}>Tuck the diagram away</Text>
        </Pressable>
      ) : null}
      {dragging ? (
        /* .rd-drag-ghost: outside the clipping frame, under the fingertip. */
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.ghost,
            { backgroundColor: colors.card, borderColor: colors.warmLine, shadowColor: colors.text },
            ghostStyle,
          ]}
          testID="drag-ghost"
        >
          <Text numberOfLines={1} style={[styles.ghostText, { color: colors.text }]}>
            {ghostLabel}
          </Text>
        </Reanimated.View>
      ) : null}
    </View>
      ) : (
        /* .rd-tucked: the collapsed stand-in for the table once every
           ingredient has combined. Tapping it brings the table back. */
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`All ${section.ingredients.length} ingredients combined. Show the full diagram again`}
          onPress={() => setOverride(true)}
          style={[styles.tucked, { backgroundColor: colors.coolBg, borderColor: colors.coolLine }]}
          testID="diagram-tucked"
        >
          <Text style={[styles.tuckedCheck, { color: colors.coolInk }]}>✓</Text>
          <Text style={[styles.tuckedText, { color: colors.coolInk }]}>
            All {section.ingredients.length} ingredients combined
          </Text>
          <Text style={[styles.tuckedMore, { color: colors.mutedForeground }]}>SHOW DIAGRAM</Text>
        </Pressable>
      )}
      <FinishStrip
        tail={tail}
        done={done}
        focus={treeDone}
        colors={colors}
        onPress={stableToggle}
        dropFor={dropForStrip}
        rowRef={stripRowRef}
        editing={!!edit}
      />
    </View>
  );
}

interface DiagramViewProps {
  recipe: Recipe;
  done: Set<string>;
  onToggle: (id: string) => void;
  scale?: number;
  edit?: DiagramEdit | null;
}

/** All sections, stacked — the web app renders one table per section. In
 *  edit mode every section shows its title as a 44px button (the web's
 *  .rd-section-head), because a section has no cell of its own to tap. */
export function DiagramView({ recipe, done, onToggle, scale, edit = null }: DiagramViewProps) {
  const colors = useColors();
  // The section with a live drag is lifted above its siblings so its ghost
  // paints over the next frame rather than under it.
  const [dragSection, setDragSection] = useState<number | null>(null);
  const dragFor = (i: number): SectionDrag | null =>
    edit
      ? {
          targetsFor: (id) => validMoveTargets(recipe, id),
          reasonFor: (id) => noTargetsReason(recipe, id),
          onMove: edit.onMove,
          onBlocked: edit.onBlocked,
          onDragChange: (on) => {
            setDragSection(on ? i : null);
            edit.onDragChange?.(on);
          },
          scrollPageBy: edit.scrollPageBy,
        }
      : null;
  return (
    <View>
      {recipe.sections.map((s, i) => (
        <View key={`${s.name}-${i}`} style={{ marginBottom: 24, zIndex: dragSection === i ? 2 : 0 }}>
          {edit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit section ${s.name}`}
              onPress={() => edit.onTapSection(i)}
              style={[styles.sectionHead, { borderColor: colors.coolLine, backgroundColor: colors.coolBg }]}
              testID={`section-head-${i}`}
            >
              <Text style={[styles.sectionName, { color: colors.coolInk, marginBottom: 0 }]}>{s.name}</Text>
              <Text style={[styles.sectionEditHint, { color: colors.coolInk }]}>Edit</Text>
            </Pressable>
          ) : recipe.sections.length > 1 ? (
            <Text style={[styles.sectionName, { color: colors.text }]}>{s.name}</Text>
          ) : null}
          {s.header ? <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{s.header}</Text> : null}
          <SectionDiagram section={s} done={done} onToggle={onToggle} scale={scale} edit={edit} drag={dragFor(i)} />
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
  tuckBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 2 },
  tuckText: { fontSize: 12, textDecorationLine: "underline" },
  tucked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  tuckedCheck: { fontSize: 15, fontWeight: "700" },
  tuckedText: { flex: 1, fontSize: 14, fontWeight: "600" },
  tuckedMore: { fontFamily: "SpaceMono_400Regular", fontSize: 10.5, letterSpacing: 0.5 },
  ingBody: { gap: 3 },
  amount: { fontFamily: "SpaceMono_400Regular", fontSize: 13, letterSpacing: -0.13 },
  name: { fontSize: 14, lineHeight: 17.5 },
  note: { fontSize: 12.5, lineHeight: 15, fontStyle: "italic" },
  opLabel: { fontSize: 14, lineHeight: 18, textAlign: "center" },
  chipBody: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  chipMark: { fontSize: 13, fontWeight: "700" },
  struck: { textDecorationLine: "line-through", opacity: 0.58 },
  // The halo sits 3px outside the ring (0 0 0 3px in the web's box-shadow)
  // and breathes; the frame clips it at the table's edge, as the web does.
  halo: { position: "absolute", top: -3, left: -3, right: -3, bottom: -3, borderWidth: 3 },
  mark: { position: "absolute", top: 3, right: 6, fontSize: 11, fontWeight: "700" },
  sectionName: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  sectionEditHint: { fontSize: 13, fontWeight: "600" },
  sectionHeader: { fontSize: 13, fontStyle: "italic", marginBottom: 8 },
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    width: GHOST_WIDTH,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    zIndex: 10,
  },
  ghostText: { fontSize: 13.5, fontWeight: "600" },
});
