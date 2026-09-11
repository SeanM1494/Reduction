/**
 * components/RecipeScreen.tsx — renders one recipe.
 *
 * The mobile RecipeView (the web's RecipeView.tsx, minus what Phase 2 owns:
 * editing, the drag, the JSON hatch, the re-read). Two views, both driven by
 * the same shared model the web app uses:
 *
 *  - Overview: the dependency DIAGRAM — components/diagram/DiagramView, the
 *    Phase 0 renderer of computeLayout's grid — with the standing facts about
 *    the recipe above it (rating once cooked, the meal-type badge) and the
 *    servings stepper, which is about tonight and changes every number in the
 *    tables (see ServingsRow's header for the rule about the two numbers).
 *  - Cook: components/recipe/StepsMode — one card at a time in dependency-
 *    safe cook order (shared/sequence.ts), ingredients checkable on the
 *    card, a persisted timer, and parallel-work suggestions while it runs.
 *    Amounts there are scaled the same way.
 *
 * The screen owns no title: the Stack header shows it (app/recipe/[id].tsx),
 * along with the overflow menu. What is left up here is the progress bar and
 * the mode tabs, which is what the web's thin bar carries too.
 *
 * `done` is an upstream-closed array of ids (see toggleDone); the diagram
 * takes a Set and toggles op cells by step id, so the two agree without any
 * translation beyond the Set. "Cooked it" is observed, not reported: the
 * moment done reaches the full count is stamped into `cooked` (deduped within
 * six hours, the same window mergeCooked uses), which is what unlocks the
 * rating.
 */

import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DiagramView } from '@/components/diagram/DiagramView';
import { ServingsRow } from '@/components/recipe/ServingsRow';
import { RatingControl } from '@/components/recipe/RatingControl';
import { StepsMode } from '@/components/recipe/StepsMode';
import { SheetButton } from '@/components/Sheet';
import type { Recipe } from '@/shared/layout';
import type { OrderPreference } from '@/shared/sequence';
import { MEAL_TYPE_LABELS, sanitizeMealTypes } from '@/shared/mealTypes';
import { countAll } from '@/shared/amounts';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';
import type { EntryPatch } from '@/lib/library-context';

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

/** Six hours: un-checking and re-checking the last step counts one dinner,
 *  not two, and two devices logging the same meal collapse to one (the same
 *  window shared/sync.ts's mergeCooked uses). */
const COOKED_DEDUPE_MS = 6 * 60 * 60 * 1000;

/** The cooked stamp for a done transition: appended when `next` completes a
 *  recipe that `prev` had not, unless one landed within the window. */
export function stampCooked(cooked: number[], prevDone: number, nextDone: number, total: number, now = Date.now()): number[] {
  if (!(total > 0 && nextDone === total && prevDone < total)) return cooked;
  const last = cooked.length ? cooked[cooked.length - 1] : 0;
  return now - last > COOKED_DEDUPE_MS ? [...cooked, now] : cooked;
}

// ------------------------------------------------------------------ props --

interface RecipeScreenProps {
  recipe: Recipe;
  done: string[];
  servings: number | null;
  timer: StepTimer | null;
  cooked: number[];
  rating: number | null;
  mode: 'diagram' | 'steps';
  /** Tonight's card-order preference (entry.order), advisory — see
   *  shared/sequence.ts. Honoured here; written by the Reorder view, which
   *  is not ported yet. */
  order?: OrderPreference | null;
  /** Every write goes through here as a partial entry — the same shape
   *  useLibrary().update takes, so app/recipe/[id].tsx passes it straight
   *  through and the draft screen can keep what it wants locally. */
  onUpdate: (patch: EntryPatch) => void;
  /** Opens the meal-type sheet, which the route owns because the header's
   *  overflow menu reaches it too. */
  onEditMealTypes?: () => void;
  /** False turns off every write that is about the recipe rather than about
   *  tonight — rating and tagging — which is the draft's case. */
  canEdit?: boolean;
  /** A write the server refused, shown until dismissed (see the web's
   *  "Writes are confirmed, not assumed"). */
  notice?: string | null;
  onDismissNotice?: () => void;
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
  cooked,
  rating,
  mode,
  order = null,
  onUpdate,
  onEditMealTypes,
  canEdit = true,
  notice,
  onDismissNotice,
  isDraft,
  onSave,
  saving,
}: RecipeScreenProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // The stored mode picks the opening tab; a tap writes it back so the next
  // open (and the other device) lands where this one left off.
  const [view, setView] = useState<ViewMode>(mode === 'steps' ? 'cook' : 'overview');
  const pickView = (v: ViewMode) => {
    setView(v);
    if (!isDraft && v !== (mode === 'steps' ? 'cook' : 'overview')) onUpdate({ mode: v === 'cook' ? 'steps' : 'diagram' });
  };

  const doneCount = done.length;
  const total = countAll(recipe);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const scale = servings && recipe.servings ? servings / recipe.servings : 1;

  const toggle = (id: string) => {
    const next = toggleDone(recipe, done, id);
    const stamped = stampCooked(cooked, done.length, next.length, total);
    onUpdate(stamped === cooked ? { done: next } : { done: next, cooked: stamped });
  };
  /** Cook mode's "Next Step": done (if not already) and the step's timer
   *  cleared, as one write — see StepsMode's onMarkDone. */
  const markDone = (stepId: string) => {
    const next = doneSet.has(stepId) ? done : toggleDone(recipe, done, stepId);
    const stamped = stampCooked(cooked, done.length, next.length, total);
    const patch: EntryPatch = { done: next };
    if (stamped !== cooked) patch.cooked = stamped;
    if (timer?.stepId === stepId) patch.timer = null;
    onUpdate(patch);
  };
  const doneSet = useMemo(() => new Set(done), [done]);
  const types = sanitizeMealTypes(recipe.mealTypes);

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <View style={styles.progressRow} accessibilityLabel={`${doneCount} of ${total} done`}>
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={[colors.warmLine, colors.coolInk]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${pct}%` }]}
            />
          </View>
          <Text style={styles.progressCount} testID="recipe-progress">
            {doneCount}/{total}
          </Text>
        </View>
        <View style={styles.modeSwitch}>
          <ModeTab label="Overview" active={view === 'overview'} onPress={() => pickView('overview')} colors={colors} />
          <ModeTab label="Cook" active={view === 'cook'} onPress={() => pickView('cook')} colors={colors} />
        </View>
      </View>

      {notice ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{notice}</Text>
          {onDismissNotice ? <SheetButton label="Dismiss" onPress={onDismissNotice} /> : null}
        </View>
      ) : null}

      {view === 'overview' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} testID="recipe-overview">
          {/* Tag and rating share a row: both are standing facts about the
              recipe rather than about this cooking session. The rating only
              appears once the recipe has actually been cooked — before that
              it would collect an opinion about a web page. */}
          {canEdit ? (
            <View style={styles.factsRow}>
              {cooked.length > 0 ? <RatingControl rating={rating} onChange={(r) => onUpdate({ rating: r })} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit meal types"
                onPress={onEditMealTypes}
                style={({ pressed }) => [styles.tagBadge, pressed && styles.tagBadgePressed]}
                testID="recipe-tag"
              >
                <Text style={styles.tagText}>{types.length ? MEAL_TYPE_LABELS[types[0]].toUpperCase() : 'TAG MEAL TYPE'}</Text>
                {types.length > 1 ? <Text style={styles.tagMore}>+{types.length - 1}</Text> : null}
              </Pressable>
            </View>
          ) : null}
          <ServingsRow
            base={recipe.servings}
            entryServings={servings}
            yieldText={recipe.yieldText}
            onChange={(next) => onUpdate({ servings: next })}
          />
          <DiagramView recipe={recipe} done={doneSet} onToggle={toggle} scale={scale} />
          <Text style={styles.hint}>
            Amber means you can do it now. Tap any step further right to jump ahead — everything it depends on gets
            marked done with it.
          </Text>
          {/* A 44px row rather than an inline link: the web's 12px anchor is
              a mouse target, and this one is tapped. */}
          {recipe.sourceUrl ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open the source page, ${recipe.source || recipe.sourceUrl}`}
              onPress={() => Linking.openURL(recipe.sourceUrl!).catch(() => {})}
              style={styles.source}
              testID="recipe-source"
            >
              <Text style={styles.sourceText} numberOfLines={1}>
                From <Text style={styles.sourceLink}>{recipe.source || recipe.sourceUrl}</Text> ↗
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <StepsMode
          recipe={recipe}
          done={doneSet}
          order={order}
          timer={timer}
          scale={scale}
          onToggle={toggle}
          onSetTimer={(t) => onUpdate({ timer: t })}
          onMarkDone={markDone}
        />
      )}

      {isDraft ? (
        <View style={styles.saveBar}>
          <Pressable style={styles.saveButton} onPress={onSave} disabled={saving} accessibilityRole="button">
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles2.tab,
        { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border },
      ]}
    >
      <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontFamily: active ? fonts.heading : fonts.headingMedium, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}
const styles2 = StyleSheet.create({
  // 44px is the touch-target floor (CLAUDE.md); the scaffold's 40px tab was
  // a desktop button that happened to be on a phone.
  tab: { flex: 1, minHeight: 44, paddingVertical: 10, borderRadius: 99, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

// ---------------------------------------------------------------- styles ---

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    top: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 12 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    progressTrack: { flex: 1, height: 5, borderRadius: 99, backgroundColor: colors.border, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 99 },
    progressCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.mutedForeground },
    modeSwitch: { flexDirection: 'row', gap: 8 },
    notice: {
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      borderRadius: 9,
      padding: 12,
      gap: 10,
    },
    noticeText: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
    factsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    tagBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 99,
      backgroundColor: colors.warmBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
    },
    tagBadgePressed: { opacity: 0.8 },
    tagText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.55, color: colors.warmInk },
    tagMore: { fontFamily: fonts.mono, fontSize: 11, color: colors.mutedForeground },
    hint: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, marginTop: 12, marginBottom: 14 },
    source: { minHeight: 44, justifyContent: 'center', marginBottom: 8 },
    sourceText: { fontSize: 12, color: colors.faint },
    sourceLink: { color: colors.mutedForeground, textDecorationLine: 'underline' },
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
      borderRadius: colors.radiusButton,
      minHeight: 44,
      paddingVertical: 14,
      alignItems: 'center',
    },
    saveButtonText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },

  });
}
