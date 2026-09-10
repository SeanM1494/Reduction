/**
 * components/RecipeScreen.tsx — renders one recipe.
 *
 * Two views, both driven by the same shared model the web app uses:
 *
 *  - Overview: the dependency DIAGRAM — components/diagram/DiagramView, the
 *    Phase 0 renderer of computeLayout's grid (see ROADMAP's mobile section).
 *    It replaced the scaffold's flat checklist on Sep 10 as the first slice of
 *    Phase 1; this is the same renderer for the demo and for a saved recipe.
 *  - Cook: one step at a time, in dependency-safe cook order
 *    (shared/sequence.ts), with an optional foreground timer for steps that
 *    have a duration.
 *
 * `done` is an upstream-closed array of ids (see toggleDone); the diagram
 * takes a Set and toggles op cells by step id, so the two agree without any
 * translation beyond the Set.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DiagramView } from '@/components/diagram/DiagramView';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Ingredient, Recipe, Step } from '@/shared/layout';
import { cardSequence } from '@/shared/sequence';
import { countAll, formatAmount, formatMinutes, stepMinutes } from '@/shared/amounts';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';

// ------------------------------------------------------------ done logic ---

/** Every id in the recipe mapped to the ids it directly depends on.
 *  Ingredients are leaves (no inputs). Ids are unique across the whole
 *  recipe — inputs never cross a section boundary (see shared/sequence.ts). */
function buildInputsOf(recipe: Recipe): Map<string, string[]> {
  const inputsOf = new Map<string, string[]>();
  for (const section of recipe.sections ?? []) {
    for (const ing of section.ingredients ?? []) inputsOf.set(ing.id, []);
    for (const node of section.nodes ?? []) inputsOf.set(node.id, node.inputs ?? []);
  }
  return inputsOf;
}

function buildDownstreamOf(inputsOf: Map<string, string[]>): Map<string, string[]> {
  const downstream = new Map<string, string[]>();
  for (const [id, inputs] of inputsOf) {
    for (const dep of inputs) {
      const list = downstream.get(dep) ?? [];
      list.push(id);
      downstream.set(dep, list);
    }
  }
  return downstream;
}

/** Checking a step marks its whole upstream chain done (you cannot have
 *  finished a step without its inputs); unchecking clears everything
 *  downstream of it. Keeps `done` upstream-closed, which is what makes the
 *  cross-device merge in shared/sync.ts provably safe (see its header). */
function toggleDone(recipe: Recipe, done: string[], id: string): string[] {
  const inputsOf = buildInputsOf(recipe);
  const set = new Set(done);
  if (set.has(id)) {
    const downstream = buildDownstreamOf(inputsOf);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (!set.delete(cur)) continue;
      for (const next of downstream.get(cur) ?? []) stack.push(next);
    }
  } else {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (set.has(cur)) continue;
      set.add(cur);
      for (const next of inputsOf.get(cur) ?? []) stack.push(next);
    }
  }
  return [...set];
}

// ------------------------------------------------------------------ props --

interface RecipeScreenProps {
  recipe: Recipe;
  done: string[];
  servings: number | null;
  timer: StepTimer | null;
  onToggleDone: (nextDone: string[]) => void;
  onSetTimer: (timer: StepTimer | null) => void;
  isDraft?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

type ViewMode = 'overview' | 'cook';

export function RecipeScreen({
  recipe,
  done,
  servings,
  timer,
  onToggleDone,
  onSetTimer,
  isDraft,
  onSave,
  saving,
}: RecipeScreenProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [view, setView] = useState<ViewMode>('overview');

  const doneCount = done.length;
  const total = countAll(recipe);
  const scale = servings && recipe.servings ? servings / recipe.servings : 1;

  const toggle = (id: string) => onToggleDone(toggleDone(recipe, done, id));
  const doneSet = useMemo(() => new Set(done), [done]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {recipe.title}
        </Text>
        {recipe.yieldText || recipe.servings ? (
          <Text style={styles.subtitle}>{recipe.yieldText || `${recipe.servings} servings`}</Text>
        ) : null}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${total ? Math.round((doneCount / total) * 100) : 0}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.modeSwitch}>
        <ModeTab label="Overview" active={view === 'overview'} onPress={() => setView('overview')} colors={colors} />
        <ModeTab label="Cook" active={view === 'cook'} onPress={() => setView('cook')} colors={colors} />
      </View>

      {view === 'overview' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} testID="recipe-overview">
          <DiagramView recipe={recipe} done={doneSet} onToggle={toggle} scale={scale} />
        </ScrollView>
      ) : (
        <CookMode
          recipe={recipe}
          done={done}
          timer={timer}
          onToggle={toggle}
          onSetTimer={onSetTimer}
          colors={colors}
        />
      )}

      {isDraft ? (
        <View style={styles.saveBar}>
          <Pressable style={styles.saveButton} onPress={onSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save to Library'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ModeTab({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles2.tab,
        { backgroundColor: active ? colors.primary : 'transparent', borderColor: colors.border },
      ]}
    >
      <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontFamily: fonts.headingMedium, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}
const styles2 = StyleSheet.create({
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
});

// ------------------------------------------------------------- helpers -----

function ingredientLabel(ing: Ingredient, scale: number): string {
  const amount = formatAmount(ing, scale);
  const note = ing.note ? ` (${ing.note})` : '';
  return amount ? `${amount} ${ing.name}${note}` : `${ing.name}${note}`;
}

// ---------------------------------------------------------------- cook -----

function CookMode({
  recipe,
  done,
  timer,
  onToggle,
  onSetTimer,
  colors,
}: {
  recipe: Recipe;
  done: string[];
  timer: StepTimer | null;
  onToggle: (id: string) => void;
  onSetTimer: (timer: StepTimer | null) => void;
  colors: Colors;
}) {
  const styles = makeStyles(colors);
  const sequence = useMemo(() => cardSequence(recipe), [recipe]);
  const doneSet = new Set(done);
  const firstUndone = sequence.findIndex((s) => !doneSet.has(s.stepId));
  const [cursor, setCursor] = useState(firstUndone === -1 ? Math.max(sequence.length - 1, 0) : firstUndone);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timer) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        if (tickRef.current) clearInterval(tickRef.current);
      };
    }
  }, [timer?.endsAt, timer?.stepId]);

  if (sequence.length === 0) {
    return (
      <View style={styles.cookEmpty}>
        <Text style={styles.rowLabel}>This recipe has no steps to cook through.</Text>
      </View>
    );
  }

  const safeCursor = Math.min(cursor, sequence.length - 1);
  const current = sequence[safeCursor];
  const section = recipe.sections[current.sectionIndex];
  const step = section.nodes.find((n) => n.id === current.stepId);
  if (!step) return null;

  const idToLabel = (id: string): string => {
    const ing = section.ingredients.find((i) => i.id === id);
    if (ing) return ingredientLabel(ing, 1);
    const node = section.nodes.find((n) => n.id === id);
    return node ? `from: ${node.label}` : id;
  };

  const minutes = stepMinutes(step.minutes);
  const remainingMs = timer && timer.stepId === step.id ? timer.endsAt - now : null;
  const remainingSec = remainingMs != null ? Math.max(0, Math.ceil(remainingMs / 1000)) : null;
  const timeUp = remainingSec === 0;

  useEffect(() => {
    if (timeUp) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [timeUp]);

  const isDone = doneSet.has(step.id);
  const isLast = safeCursor === sequence.length - 1;

  const markDoneAndAdvance = () => {
    if (!isDone) onToggle(step.id);
    if (timer?.stepId === step.id) onSetTimer(null);
    if (!isLast) setCursor(safeCursor + 1);
  };

  return (
    <View style={styles.cookContainer}>
      <Text style={styles.cookProgress}>
        Step {safeCursor + 1} of {sequence.length} · {section.name}
      </Text>

      <View style={styles.cookCard}>
        <Text style={styles.cookLabel}>{step.label}</Text>
        {step.tempF ? <Text style={styles.cookMeta}>{step.tempF}°F</Text> : null}

        {step.inputs.length > 0 ? (
          <View style={styles.cookInputs}>
            {step.inputs.map((id) => (
              <Text key={id} style={styles.cookInputItem}>
                • {idToLabel(id)}
              </Text>
            ))}
          </View>
        ) : null}

        {minutes ? (
          <View style={styles.timerBlock}>
            {remainingSec != null ? (
              <Text style={[styles.timerText, timeUp && styles.timerDone]}>
                {timeUp ? "Time's up" : formatCountdown(remainingSec)}
              </Text>
            ) : (
              <Pressable
                style={styles.timerButton}
                onPress={() => onSetTimer({ stepId: step.id, endsAt: Date.now() + minutes * 60_000 })}
              >
                <Text style={styles.timerButtonText}>Start {formatMinutes(minutes)} timer</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.cookNav}>
        <Pressable
          style={[styles.navButton, safeCursor === 0 && styles.navButtonDisabled]}
          disabled={safeCursor === 0}
          onPress={() => setCursor(Math.max(0, safeCursor - 1))}
        >
          <Text style={styles.navButtonText}>Back</Text>
        </Pressable>
        <Pressable style={[styles.navButton, styles.navButtonPrimary]} onPress={markDoneAndAdvance}>
          <Text style={styles.navButtonPrimaryText}>{isLast ? 'Done cooking' : 'Done → next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- styles ---

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 4 },
    title: { fontFamily: fonts.headingBold, fontSize: 24, color: colors.foreground },
    subtitle: { fontSize: 14, color: colors.mutedForeground },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.muted,
      marginTop: 8,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.warmLine },
    modeSwitch: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 100, gap: 24 },
    section: { gap: 4 },
    sectionTitle: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.foreground, marginBottom: 2 },
    sectionHeader: { fontSize: 13, color: colors.mutedForeground, marginBottom: 6, fontStyle: 'italic' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxDone: { backgroundColor: colors.coolLine, borderColor: colors.coolLine },
    checkmark: { color: '#fff', fontSize: 13, fontFamily: fonts.headingBold },
    rowLabel: { flex: 1, fontSize: 15, color: colors.foreground },
    rowLabelDone: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
    saveBar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
    },
    saveButtonText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },

    cookEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    cookContainer: { flex: 1, paddingHorizontal: 20, gap: 16 },
    cookProgress: { fontSize: 13, color: colors.mutedForeground, textAlign: 'center' },
    cookCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      gap: 12,
    },
    cookLabel: { fontFamily: fonts.headingMedium, fontSize: 20, color: colors.foreground },
    cookMeta: { fontSize: 14, color: colors.warmInk, fontFamily: fonts.mono },
    cookInputs: { gap: 4, marginTop: 4 },
    cookInputItem: { fontSize: 14, color: colors.mutedForeground },
    timerBlock: { marginTop: 8, alignItems: 'center' },
    timerButton: {
      backgroundColor: colors.warmBg,
      borderRadius: colors.radius,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    timerButtonText: { color: colors.warmInk, fontFamily: fonts.headingMedium, fontSize: 14 },
    timerText: { fontFamily: fonts.mono, fontSize: 36, color: colors.foreground },
    timerDone: { color: colors.warmInk },
    cookNav: { flexDirection: 'row', gap: 12 },
    navButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: colors.radius,
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    navButtonDisabled: { opacity: 0.4 },
    navButtonText: { color: colors.foreground, fontFamily: fonts.headingMedium, fontSize: 15 },
    navButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    navButtonPrimaryText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 15 },
  });
}
