/**
 * components/recipe/ReorderView.tsx — "do this branch first."
 *
 * The web's ReorderView.tsx ported. Card order is derived — a depth-first
 * walk plus the section sort in shared/sequence.ts — and that is correct: a
 * step can never be asked for before its inputs. But where the tree is
 * genuinely indifferent (two branches meeting at a fold, sections with no
 * name link between them) the walk picks an order and the cook has no say.
 * This view is the say.
 *
 * WHAT IT WRITES: `entry.order`, never the tree — tonight's cards, one
 * person's. The step sheet's Order list (Phase 2) rewrites `inputs`, which
 * is the recipe for everyone. Same fact, different scope (CLAUDE.md, "Card
 * order has two homes"). Pruned on write through `pruneOrderPreference`,
 * so what is stored is only ever things that exist.
 *
 * WHAT MAY BE DRAGGED IS DECIDED BY sequence.ts, NOT HERE. `branchChoices`
 * and `freeSectionIndices` come from the same module as the walk that will
 * honour the result, so a row gets a grip only when the walk can actually
 * honour a move of it — movability is visible BEFORE the gesture, and no
 * drop is ever rejected after the fact.
 *
 * THE GESTURE: press and hold a row with a grip (gesture-handler's Pan,
 * activated after a long press so the list still scrolls normally), a
 * ghost of the row follows the finger, valid targets light up, and the row
 * under the finger at release takes the drop. Hit-testing is by the rows'
 * own measured layout, not by elementFromPoint. Nothing in the list moves
 * during the drag (CLAUDE.md, "The drag must not reflow anything").
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { Recipe } from '@/shared/layout';
import {
  applyBranchPreference,
  branchChoices,
  freeSectionIndices,
  pruneOrderPreference,
  sectionOrder,
  stepSequence,
  type OrderPreference,
} from '@/shared/sequence';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const secId = (i: number) => `sec:${i}`;
const stepRowId = (id: string) => `step:${id}`;
const HOLD_MS = 250;
/** Suppressing native scroll for the whole drag (the pan owns the gesture)
 *  is why the drag has to scroll the list itself near the screen's edges:
 *  in a 30-step recipe the section a cook wants to move first is a screen
 *  away from where it has to go. */
const EDGE_PX = 90;
const EDGE_STEP_PX = 10;
const EDGE_TICK_MS = 16;

interface Props {
  recipe: Recipe;
  order: OrderPreference | null;
  done: Set<string>;
  onSetOrder: (next: OrderPreference | null) => void;
  onClose: () => void;
}

interface RowModel {
  id: string;
  label: string;
  kind: 'section' | 'step';
  movable: boolean;
  aside: string | null;
  isDone: boolean;
  /** Ids this row may be dropped on — what the walk can honour. */
  targets: string[];
  /** For a step row: the convergence its branch belongs to. */
  choice: { stepId: string; branchRoots: string[] } | null;
  sectionIndex: number;
}

/** Standard list displacement: the dragged thing takes the target's
 *  position — before it when coming from below, after it when coming from
 *  above — so first and last are reachable by dropping on each other. */
const displace = <T,>(xs: T[], from: number, to: number): T[] => {
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
};

export function buildRows(recipe: Recipe, order: OrderPreference | null, done: Set<string>): { rows: RowModel[]; anyMovable: boolean; displayedSecIdx: number[] } {
  // The display IS the walk's answer under the current preference, so what
  // the list shows and what the cards will do cannot disagree.
  const secIdx = sectionOrder(recipe, order ?? undefined);
  const free = freeSectionIndices(recipe);
  const effective = recipe.sections.map((s) => (order?.branches ? applyBranchPreference(s, order.branches) : s));
  const choices = branchChoices({ ...recipe, sections: effective });
  const rootToChoice = new Map<string, { stepId: string; branchRoots: string[]; consumerLabel: string }>();
  for (const c of choices) {
    const consumer = effective[c.sectionIndex].nodes.find((n) => n.id === c.stepId);
    for (const root of c.branchRoots) rootToChoice.set(root, { stepId: c.stepId, branchRoots: c.branchRoots, consumerLabel: consumer?.label ?? '' });
  }
  const sectionsMovable = free.size >= 1 && recipe.sections.length >= 2;
  const rows: RowModel[] = [];
  for (const i of secIdx) {
    if (recipe.sections.length > 1) {
      const movable = sectionsMovable && free.has(i);
      rows.push({
        id: secId(i),
        label: recipe.sections[i].name,
        kind: 'section',
        movable,
        aside: movable ? null : 'used by another section',
        isDone: false,
        targets: movable ? secIdx.map(secId).filter((x) => x !== secId(i)) : [],
        choice: null,
        sectionIndex: i,
      });
    }
    for (const id of stepSequence(effective[i])) {
      const node = effective[i].nodes.find((n) => n.id === id)!;
      const choice = rootToChoice.get(id) ?? null;
      rows.push({
        id: stepRowId(id),
        label: node.label,
        kind: 'step',
        movable: !!choice,
        aside: choice ? `branch into “${choice.consumerLabel}”` : null,
        isDone: done.has(id),
        targets: choice ? choice.branchRoots.map(stepRowId).filter((x) => x !== stepRowId(id)) : [],
        choice: choice ? { stepId: choice.stepId, branchRoots: choice.branchRoots } : null,
        sectionIndex: i,
      });
    }
  }
  return { rows, anyMovable: rows.some((r) => r.movable), displayedSecIdx: secIdx };
}

export function ReorderView({ recipe, order, done, onSetOrder, onClose }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { rows, anyMovable, displayedSecIdx } = useMemo(() => buildRows(recipe, order, done), [recipe, order, done]);

  const commit = useCallback(
    (next: OrderPreference | null) => onSetOrder(pruneOrderPreference(recipe, next)),
    [recipe, onSetOrder]
  );

  const move = useCallback(
    (fromId: string, toId: string) => {
      if (fromId.startsWith('sec:') && toId.startsWith('sec:')) {
        const from = displayedSecIdx.indexOf(Number(fromId.slice(4)));
        const to = displayedSecIdx.indexOf(Number(toId.slice(4)));
        if (from < 0 || to < 0 || from === to) return;
        commit({ ...(order ?? {}), sections: displace(displayedSecIdx, from, to).map((i) => recipe.sections[i].name) });
        return;
      }
      if (fromId.startsWith('step:') && toId.startsWith('step:')) {
        const row = rows.find((r) => r.id === fromId);
        if (!row?.choice) return;
        const roots = row.choice.branchRoots;
        const from = roots.indexOf(fromId.slice(5));
        const to = roots.indexOf(toId.slice(5));
        if (from < 0 || to < 0 || from === to) return;
        commit({ ...(order ?? {}), branches: { ...(order?.branches ?? {}), [row.choice.stepId]: displace(roots, from, to) } });
      }
    },
    [rows, displayedSecIdx, order, recipe, commit]
  );

  // ---- the drag ----------------------------------------------------------
  // Row frames relative to the list, from onLayout. The list is what the
  // ghost is positioned in, so finger y is converted once at pickup.
  // Row frames in WINDOW space, measured at pickup — onLayout's y is
  // relative to whatever the platform's gesture wrapper makes the parent
  // (the list on native, the page under react-native-web), so it cannot be
  // compared with a finger's absoluteY. measureInWindow can.
  const rowRefs = useRef(new Map<string, View | null>());
  const frames = useRef(new Map<string, { y: number; h: number }>());
  const listRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const listTop = useRef(0);
  const scrollY = useRef(0);
  const scrollAtPickup = useRef(0);
  const lastAbsoluteY = useRef(0);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { height: windowH } = useWindowDimensions();
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const draggingRef = useRef<RowModel | null>(null);
  const hoverRef = useRef<string | null>(null);
  const ghostY = useSharedValue(0);
  const ghostOn = useSharedValue(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };
  /** How far the list has scrolled since pickup; frames were measured then. */
  const scrolled = () => scrollY.current - scrollAtPickup.current;

  const rowAt = (windowY: number): string | null => {
    const d = scrolled();
    for (const [id, f] of frames.current) if (windowY >= f.y - d && windowY < f.y - d + f.h) return id;
    return null;
  };

  // The drag callbacks run on the JS thread (runOnJS from the gesture's
  // worklets): they read the measured frames, which live in JS.
  const place = (absoluteY: number) => {
    const row = draggingRef.current;
    const h = row ? (frames.current.get(row.id)?.h ?? 44) : 44;
    // List space: the list itself moved up by `scrolled()` since pickup.
    ghostY.value = absoluteY - listTop.current + scrolled() - h / 2;
  };
  const settle = (absoluteY: number) => {
    const row = draggingRef.current;
    if (!row) return;
    lastAbsoluteY.current = absoluteY;
    place(absoluteY);
    const under = rowAt(absoluteY);
    const next = under && row.targets.includes(under) ? under : null;
    if (next !== hoverRef.current) {
      hoverRef.current = next;
      setHover(next);
    }
  };
  const stopEdge = () => {
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  const edgeScroll = (absoluteY: number) => {
    const dir = absoluteY < EDGE_PX ? -1 : absoluteY > windowH - EDGE_PX ? 1 : 0;
    if (dir === 0) {
      stopEdge();
      return;
    }
    if (edgeTimer.current) return;
    edgeTimer.current = setInterval(() => {
      const next = Math.max(0, scrollY.current + dir * EDGE_STEP_PX);
      if (next === scrollY.current) return;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollY.current = next;
      settle(lastAbsoluteY.current);
    }, EDGE_TICK_MS);
  };
  useEffect(() => stopEdge, []);

  const begin = (row: RowModel, absoluteY: number) => {
    draggingRef.current = row;
    hoverRef.current = null;
    scrollAtPickup.current = scrollY.current;
    lastAbsoluteY.current = absoluteY;
    setDragging(row.id);
    setHover(null);
    listRef.current?.measureInWindow((_x, y) => {
      listTop.current = y;
    });
    for (const [id, ref] of rowRefs.current) {
      ref?.measureInWindow((_x, y, _w, h) => {
        frames.current.set(id, { y, h });
        if (id === row.id) {
          place(absoluteY);
          ghostOn.value = 1;
        }
      });
    }
  };
  const track = (absoluteY: number) => {
    if (!draggingRef.current) return;
    settle(absoluteY);
    edgeScroll(absoluteY);
  };
  const finish = (drop: boolean) => {
    stopEdge();
    const row = draggingRef.current;
    const target = hoverRef.current;
    draggingRef.current = null;
    hoverRef.current = null;
    ghostOn.value = 0;
    setDragging(null);
    setHover(null);
    if (drop && row && target) move(row.id, target);
  };

  const gestureFor = (row: RowModel) =>
    Gesture.Pan()
      .activateAfterLongPress(HOLD_MS)
      .onStart((e) => {
        runOnJS(begin)(row, e.absoluteY);
      })
      .onUpdate((e) => {
        runOnJS(track)(e.absoluteY);
      })
      .onEnd(() => {
        runOnJS(finish)(true);
      })
      .onFinalize((_e, success) => {
        if (!success) runOnJS(finish)(false);
      });

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ghostY.value }],
    opacity: ghostOn.value,
  }));

  const draggedRow = dragging ? rows.find((r) => r.id === dragging) ?? null : null;

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      scrollEnabled={!dragging}
      contentContainerStyle={styles.wrap}
      testID="reorder-view"
    >
      <View style={styles.head}>
        <Text style={styles.title}>Cooking order</Text>
        <SheetButton label="Done" onPress={onClose} testID="reorder-done" />
      </View>

      {anyMovable ? (
        <>
          <Text style={styles.hint}>
            Press and hold a row with a grip, then drop it on another. Only work the recipe leaves interchangeable can
            move — everything else is fixed by what depends on what.
          </Text>
          {order ? (
            <View style={styles.resetRow}>
              <SheetButton label="Reset to the recipe's own order" onPress={() => commit(null)} testID="reorder-reset" />
            </View>
          ) : null}
        </>
      ) : (
        /* The common case, and a real answer rather than an apology: a linear
           recipe, or linked sections, leave exactly one valid order. */
        <Text style={styles.empty} accessibilityRole="text" testID="reorder-empty">
          Every step here depends on the one before it — there's nothing to reorder. When a recipe has independent
          branches or sections, this is where you choose what to cook first.
        </Text>
      )}

      <View ref={listRef} style={styles.list} collapsable={false}>
        {rows.map((row) => {
          const lifted = dragging === row.id;
          const isTarget = !!dragging && draggedRow?.targets.includes(row.id);
          const isHover = hover === row.id;
          const rowStyle = [
            styles.row,
            row.kind === 'step' && recipe.sections.length > 1 && styles.stepRow,
            row.movable && styles.rowMovable,
            lifted && styles.rowLifted,
            dragging && !isTarget && !lifted && styles.rowNo,
            isTarget && styles.rowOk,
            isHover && styles.rowOver,
          ];
          const body = (
            <View
              ref={(r) => {
                rowRefs.current.set(row.id, r);
              }}
              collapsable={false}
              style={rowStyle}
              testID={`reorder-row-${row.id}`}
              accessibilityLabel={row.movable ? `${row.label}, movable` : row.label}
            >
              <Text style={[styles.grip, !row.movable && styles.gripOff]}>{row.movable ? '⋮⋮' : ''}</Text>
              <Text style={[styles.label, row.kind === 'section' && styles.sectionLabel, row.isDone && styles.labelDone]} numberOfLines={1}>
                {row.label}
              </Text>
              {row.aside ? (
                <Text style={styles.aside} numberOfLines={1}>
                  {row.aside}
                </Text>
              ) : null}
            </View>
          );
          return row.movable ? (
            <GestureDetector key={row.id} gesture={gestureFor(row)}>
              {body}
            </GestureDetector>
          ) : (
            <React.Fragment key={row.id}>{body}</React.Fragment>
          );
        })}

        {/* The ghost: a copy of the lifted row's label following the finger,
            positioned in the list, never intercepting the hit test. */}
        {draggedRow ? (
          <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]} testID="reorder-ghost">
            <Text style={styles.ghostText} numberOfLines={1}>
              {draggedRow.label}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 20, paddingBottom: 100 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
    title: { fontFamily: fonts.heading, fontSize: 17, color: colors.foreground },
    hint: { fontSize: 12.5, lineHeight: 18, color: colors.mutedForeground, marginBottom: 10 },
    resetRow: { flexDirection: 'row', marginBottom: 10 },
    empty: {
      marginTop: 8,
      marginBottom: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontSize: 13.5,
      lineHeight: 20,
      color: colors.mutedForeground,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: 12,
    },
    list: { position: 'relative', gap: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      minHeight: 44,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    stepRow: { marginLeft: 14 },
    rowMovable: { backgroundColor: colors.card, borderColor: colors.border },
    rowLifted: { opacity: 0.35 },
    rowNo: { opacity: 0.45 },
    rowOk: { backgroundColor: colors.coolBg, borderColor: colors.coolLine },
    rowOver: { borderWidth: 2, borderColor: colors.coolInk },
    grip: { width: 18, textAlign: 'center', color: colors.faint, letterSpacing: -2, fontSize: 14 },
    gripOff: { width: 18 },
    label: { flex: 1, fontSize: 15, color: colors.foreground },
    sectionLabel: { fontFamily: fonts.heading },
    labelDone: { color: colors.faint, textDecorationLine: 'line-through' },
    aside: { maxWidth: '40%', fontSize: 10.5, color: colors.faint },
    ghost: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      shadowColor: '#3a2418',
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    ghostText: { fontSize: 15, color: colors.foreground },
  });
}
