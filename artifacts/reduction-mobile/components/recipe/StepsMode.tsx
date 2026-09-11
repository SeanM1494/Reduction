/**
 * components/recipe/StepsMode.tsx — step-by-step cooking mode, the web's
 * StepsMode.tsx ported.
 *
 * Same data, same `done` set as the diagram — this just walks it as a card
 * sequence instead of a table. The order comes from shared/sequence.ts
 * (`cardSequence`, honouring `entry.order` as an advisory tie-break), which
 * derives it from computeLayout's own columns and rows and then orders the
 * sections so a component is made before the section that consumes it. A
 * queue that hands you "bake" before "mix the dry ingredients" is wrong in a
 * kitchen, and it shipped once on the web.
 *
 * Every step is one card: its raw ingredients live on the same card as the
 * action, as checkable rows, framed as a short instruction — "In a bowl,
 * add: … Then mix these together." — rather than a bare label with a
 * separate prep card. Steps with nothing to add show their label directly.
 *
 * Timers persist via an absolute `endsAt` on the entry, never a running
 * countdown: the interval here only forces a re-render each second, and
 * reopening the app recomputes remaining time from endsAt − now, however
 * long it was closed. While parked on a timed card, a step from ANOTHER
 * section whose inputs are all done is offered as parallel work — a
 * different section is always a different tree, so it can never be
 * downstream of the current step — and "Back to timer" is one tap however
 * far the suggestion is browsed.
 *
 * Not ported yet: the sweep animation between cards, and the Reorder view
 * (`entry.order` is honoured when present; writing it needs a drag list —
 * see ROADMAP's next slices).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Ingredient, Recipe, Step } from '@/shared/layout';
import { cardSequence, type OrderPreference } from '@/shared/sequence';
import { formatAmount, formatMinutes, stepMinutes } from '@/shared/amounts';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';

interface StepCard {
  key: string;
  stepId: string;
  step: Step;
  sectionIndex: number;
  sectionName: string;
  ingredients: Ingredient[];
  fromLabels: string[];
  actionNumber: number;
}

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A short lead-in + closing pair so the card reads like an instruction
// rather than a bare verb. Only steps with ingredients use this.
const leadFor = (label: string): string => (/\bmix\b/i.test(label) ? 'In a bowl, add' : 'Add');
const closingFor = (label: string): string => {
  const trimmed = label.trim();
  return /^mix$/i.test(trimmed) ? 'mix these together' : trimmed;
};

export function buildCards(recipe: Recipe, order: OrderPreference | null | undefined): { cards: StepCard[]; totalActions: number } {
  const cards: StepCard[] = [];
  let actionNumber = 0;
  const totalActions = recipe.sections.reduce((n, s) => n + (s.nodes?.length || 0), 0);
  const byId = new Map<string, Step>();
  for (const section of recipe.sections) for (const n of section.nodes) byId.set(n.id, n);

  for (const { sectionIndex, stepId } of cardSequence(recipe, order ?? undefined)) {
    const step = byId.get(stepId);
    if (!step) continue;
    const section = recipe.sections[sectionIndex];
    const ingById = new Map(section.ingredients.map((i) => [i.id, i]));
    const nodeById = new Map(section.nodes.map((n) => [n.id, n]));
    const ingredients = (step.inputs || []).map((id) => ingById.get(id)).filter((x): x is Ingredient => !!x);
    const fromLabels = (step.inputs || []).map((id) => nodeById.get(id)?.label).filter((x): x is string => !!x);
    actionNumber++;
    cards.push({ key: step.id, stepId: step.id, step, sectionIndex, sectionName: section.name, ingredients, fromLabels, actionNumber });
  }
  return { cards, totalActions };
}

interface Props {
  recipe: Recipe;
  done: Set<string>;
  order: OrderPreference | null;
  timer: StepTimer | null;
  scale: number;
  onToggle: (id: string) => void;
  onSetTimer: (timer: StepTimer | null) => void;
  /** "Next Step" on a card: marks the step done AND clears its timer in ONE
   *  write. Two back-to-back updates would race their own ifVersion and pay
   *  a 409-merge-retry on the most common tap in the kitchen. */
  onMarkDone: (stepId: string) => void;
}

export function StepsMode({ recipe, done, order, timer, scale, onToggle, onSetTimer, onMarkDone }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { cards, totalActions } = useMemo(() => buildCards(recipe, order), [recipe, order]);

  // Position in the sequence, taken at mount: RecipeScreen unmounts this
  // whenever the diagram is showing, so re-entering resumes at the first
  // thing not yet done, matching whatever happened in the diagram meanwhile.
  const [cardIndex, setCardIndex] = useState(() => {
    const first = cards.findIndex((c) => !done.has(c.stepId));
    return first === -1 ? cards.length : first;
  });
  const [returnIndex, setReturnIndex] = useState<number | null>(null);
  const goTo = useCallback((i: number) => setCardIndex(Math.max(0, Math.min(cards.length, i))), [cards.length]);
  const card: StepCard | null = cardIndex < cards.length ? cards[cardIndex] : null;

  // ---- timer ---------------------------------------------------------------
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const timerForCurrent = timer && card && timer.stepId === card.stepId ? timer : null;
  const remainingMs = timerForCurrent ? timerForCurrent.endsAt - Date.now() : null;
  const elapsed = remainingMs != null && remainingMs <= 0;

  // One buzz per timer, the moment it crosses from running to elapsed.
  const notifiedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!timerForCurrent || !elapsed) return;
    const key = `${timerForCurrent.stepId}@${timerForCurrent.endsAt}`;
    if (notifiedForRef.current === key) return;
    notifiedForRef.current = key;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [timerForCurrent, elapsed]);

  const startTimer = useCallback(
    (step: Step) => onSetTimer({ stepId: step.id, endsAt: Date.now() + (stepMinutes(step.minutes) ?? 0) * 60_000 }),
    [onSetTimer]
  );

  // ---- parallel work -------------------------------------------------------
  const parallelSuggestion = useMemo(() => {
    if (!card || stepMinutes(card.step.minutes) == null) return null;
    const candidate = cards.find(
      (c) => c.sectionIndex !== card.sectionIndex && !done.has(c.stepId) && (c.step.inputs || []).every((i) => done.has(i))
    );
    return candidate ? { card: candidate, index: cards.indexOf(candidate) } : null;
  }, [card, cards, done]);

  const jumpToSuggestion = () => {
    if (!parallelSuggestion) return;
    setReturnIndex(cardIndex);
    goTo(parallelSuggestion.index);
  };
  const backToTimer = () => {
    if (returnIndex == null) return;
    goTo(returnIndex);
    setReturnIndex(null);
  };

  const markDone = (c: StepCard) => {
    onMarkDone(c.stepId);
    if (returnIndex != null && cardIndex === returnIndex) setReturnIndex(null);
    goTo(cardIndex + 1);
  };

  if (cards.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>This recipe has no steps to cook through yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} testID="recipe-cook">
      {returnIndex != null && cardIndex !== returnIndex ? (
        <Pressable accessibilityRole="button" onPress={backToTimer} style={styles.returnBtn} testID="cook-return">
          <Text style={styles.returnText}>← Back to timer</Text>
        </Pressable>
      ) : null}

      {!card ? (
        <View style={styles.card} testID="cook-finished">
          <Text style={styles.finished}>Every step is done. Enjoy.</Text>
          <View style={styles.nav}>
            <SheetButton label="← Back" onPress={() => goTo(cardIndex - 1)} />
          </View>
        </View>
      ) : (
        <View style={styles.card} key={card.key}>
          <Text style={styles.eyebrow}>
            {card.sectionName} · Step {card.actionNumber} of {totalActions}
          </Text>
          {card.fromLabels.length ? <Text style={styles.builds}>Builds on: {card.fromLabels.join(', ')}</Text> : null}

          {card.ingredients.length ? (
            <>
              <Text style={styles.lead}>{leadFor(card.step.label)}:</Text>
              <View style={styles.prepList}>
                {card.ingredients.map((ing) => {
                  const isDone = done.has(ing.id);
                  const amount = formatAmount(ing, scale);
                  return (
                    <Pressable
                      key={ing.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isDone }}
                      aria-checked={isDone}
                      accessibilityLabel={`${amount} ${ing.name}`}
                      onPress={() => onToggle(ing.id)}
                      style={[styles.prepRow, isDone && styles.prepRowDone]}
                      testID="cook-ingredient"
                    >
                      <View style={[styles.check, isDone && styles.checkDone]}>
                        {isDone ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      {amount ? <Text style={styles.amount}>{amount}</Text> : null}
                      <Text style={[styles.name, isDone && styles.nameDone]}>
                        {ing.name}
                        {ing.note ? <Text style={styles.note}>, {ing.note}</Text> : null}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.closing}>Then {closingFor(card.step.label)}.</Text>
            </>
          ) : (
            <Text style={styles.label}>{card.step.label}</Text>
          )}
          {card.step.tempF ? <Text style={styles.temp}>{card.step.tempF}°F</Text> : null}

          {stepMinutes(card.step.minutes) != null ? (
            <View style={styles.timerBox} testID="cook-timer">
              {timerForCurrent ? (
                elapsed ? (
                  <Text style={styles.timerAlert} accessibilityLiveRegion="assertive">
                    Time's up — {card.step.label}
                  </Text>
                ) : (
                  <Text style={styles.timerCount}>{fmtRemaining(remainingMs!)}</Text>
                )
              ) : (
                <SheetButton label={`Start timer (${formatMinutes(card.step.minutes)})`} onPress={() => startTimer(card.step)} testID="cook-start-timer" />
              )}
              {parallelSuggestion ? (
                <Pressable accessibilityRole="button" onPress={jumpToSuggestion} style={styles.parallel} testID="cook-parallel">
                  <Text style={styles.parallelText}>
                    While that's going — start {parallelSuggestion.card.sectionName}: {parallelSuggestion.card.step.label}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={styles.nav}>
            {cardIndex > 0 ? <SheetButton label="← Back" onPress={() => goTo(cardIndex - 1)} /> : null}
            <Pressable accessibilityRole="button" onPress={() => markDone(card)} style={styles.primary} testID="cook-next">
              <Text style={styles.primaryText}>Next Step →</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 20, paddingBottom: 100, gap: 12 },
    empty: { padding: 20 },
    emptyText: { fontSize: 14, color: colors.mutedForeground },
    returnBtn: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: 99,
      backgroundColor: colors.warmBg,
      borderWidth: 1,
      borderColor: colors.warmLine,
    },
    returnText: { fontSize: 12.5, fontWeight: '600', color: colors.warmInk },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 17,
      paddingTop: 20,
      paddingHorizontal: 18,
      paddingBottom: 16,
      ...cardShadow,
    },
    eyebrow: { fontSize: 12.5, fontWeight: '600', color: colors.mutedForeground, marginBottom: 10 },
    builds: { fontSize: 12.5, color: colors.faint, marginBottom: 16 },
    lead: { fontSize: 15, fontWeight: '600', color: colors.foreground, marginBottom: 10 },
    prepList: { gap: 8, marginBottom: 16 },
    prepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 44,
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: colors.radius,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    prepRowDone: { backgroundColor: colors.coolBg, borderColor: colors.coolLine },
    check: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkDone: { backgroundColor: colors.coolLine, borderColor: colors.coolLine },
    checkMark: { color: '#fff', fontSize: 11, lineHeight: 13, fontFamily: fonts.headingBold },
    amount: { fontFamily: fonts.mono, fontSize: 13, color: colors.mutedForeground },
    name: { flex: 1, fontSize: 15, color: colors.foreground },
    nameDone: { color: colors.coolInk },
    note: { fontStyle: 'italic', color: colors.mutedForeground },
    closing: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 26, letterSpacing: -0.2, color: colors.foreground, marginTop: 4, marginBottom: 10 },
    label: { fontFamily: fonts.headingBold, fontSize: 26, lineHeight: 29, letterSpacing: -0.5, color: colors.foreground, marginBottom: 10 },
    temp: { fontFamily: fonts.mono, fontSize: 14, color: colors.warmInk, marginBottom: 10 },
    timerBox: {
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 4,
      marginBottom: 20,
      padding: 14,
      borderRadius: 13,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    timerCount: { fontFamily: fonts.monoBold, fontSize: 28, letterSpacing: 0.5, color: colors.foreground },
    timerAlert: { fontSize: 15, fontWeight: '600', color: colors.warmInk },
    parallel: {
      alignSelf: 'stretch',
      minHeight: 44,
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 13,
      borderRadius: 10,
      backgroundColor: colors.warmBg,
      borderWidth: 1,
      borderColor: colors.warmLine,
    },
    parallelText: { fontSize: 13, lineHeight: 18, color: colors.warmInk },
    nav: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 4 },
    primary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
    },
    primaryText: { fontSize: 15, fontFamily: fonts.heading, color: colors.primaryForeground },
    finished: { fontSize: 16, fontWeight: '600', color: colors.foreground, marginBottom: 16 },
  });
}
