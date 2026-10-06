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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DiagramView } from '@/components/diagram/DiagramView';
import { ServingsRow } from '@/components/recipe/ServingsRow';
import { RecipePhotoThumb } from '@/components/recipe/RecipePhotoThumb';
import { RatingControl } from '@/components/recipe/RatingControl';
import { NotesSheet } from '@/components/recipe/NotesSheet';
import { thumbSize } from '@/components/recipe/RecipePhotoThumb';
import { noteStripFits } from '@/lib/notesStrip';
import { asksForRating } from '@/lib/recipeBox';
import { StepsMode } from '@/components/recipe/StepsMode';
import { EditSheet, type EditTarget } from '@/components/edit/EditSheet';
import { Sheet, SheetButton, SheetNote } from '@/components/Sheet';
import { Window } from '@/components/Window';
import { useToast } from '@/components/Toast';
import { validateRecipe, type Recipe } from '@/shared/layout';
import { applyEdit, type EditOp } from '@/shared/edits';
import { countDone, reconcileDone } from '@/shared/progress';
import type { OrderPreference } from '@/shared/sequence';
import { countAll } from '@/shared/amounts';
import { titleProblem } from '@/shared/title';
import {
  NOTE_MAX,
  STEP_NOTE_MAX,
  cleanNotes,
  notesPreview,
  notesText,
  stepNote,
  stepNotesInOrder,
  withStepNote,
  type RecipeNotes,
} from '@/shared/notes';
import { Feather } from '@expo/vector-icons';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry, StepTimer } from '@/lib/api';
import type { EntryPatch } from '@/lib/library-context';
import { clearProgressPatch } from '@/lib/cookReset';
import { useKeepAwakeWhile } from '@/lib/keepAwake';
import { toggleDone } from '@/lib/doneClosure';
import { pointerFor, type Pointer, type Spotlight } from '@/lib/spotlight';
import type { CookActivity } from '@/lib/cookCounters';
import { TapPointer } from '@/components/demo/TapPointer';
import { SpotRing } from '@/components/demo/SpotRing';
import { makeReveal, RevealContext } from '@/components/demo/reveal';

// ------------------------------------------------------------ done logic ---
// toggleDone lives in lib/doneClosure.ts (pure), so the demo guide's "Show
// me" performs a tap by exactly the rule a tap here follows.

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

/** What the recipe route's ⋮ menu can ask this screen for. */
/** `clear` is the finish window's "Start fresh" (the same write as Clear
 *  progress, with no confirm: the window was the question); `resume` follows
 *  an Undo of it, after the route has written the checks back. */
export type RecipeRequest = { kind: 'edit' | 'reorder' | 'servings' | 'rating' | 'notes' | 'clear' | 'resume'; n: number };

interface RecipeScreenProps {
  recipe: Recipe;
  done: string[];
  servings: number | null;
  timer: StepTimer | null;
  cooked: number[];
  rating: number | null;
  /** The person's own notes (recipe-model notes.ts). Absent — a preview,
   *  the demo — and the page has no notes at all. */
  notes?: RecipeNotes | null;
  mode: 'diagram' | 'steps';
  /** Tonight's card-order preference (entry.order), advisory — see
   *  shared/sequence.ts. Honoured here; written by the Reorder view, which
   *  is not ported yet. */
  order?: OrderPreference | null;
  /** Every write goes through here as a partial entry — the same shape
   *  useLibrary().update takes, so app/recipe/[id].tsx passes it straight
   *  through and the draft screen can keep what it wants locally. */
  onUpdate: (patch: EntryPatch) => void;
  /** False turns off every write that is about the recipe rather than about
   *  tonight — rating and tagging — which is the draft's case. */
  canEdit?: boolean;
  /** Something the route's ⋮ menu asked for, with a counter so asking twice
   *  is two requests. Everything that is not tonight's cooking lives in that
   *  menu (Sep 25): editing, the card order, servings and the rating. The
   *  page itself keeps only the picture and Clear progress. */
  request?: RecipeRequest | null;
  /** A write the server refused, shown until dismissed (see the web's
   *  "Writes are confirmed, not assumed"). */
  notice?: string | null;
  onDismissNotice?: () => void;
  /** A write is waiting for the network: what is on screen is kept and will
   *  be sent when the connection returns, so the banner is calm, not red. */
  offlineQueued?: boolean;
  isDraft?: boolean;
  onSave?: () => void;
  /** One more sentence for the preview's banner, e.g. that saving a
   *  starter uses one of the free recipes (lib/reelView.ts). */
  draftNote?: string | null;
  /** A preview's title is the person's to change before it is saved: the
   *  banner shows it with a Rename, and a blank one opens it from Save. */
  onEditTitle?: () => void;
  /** The book the preview will be saved into, beside Save, and the way to
   *  change it. Absent when the server has no books: Save saves, as ever. */
  bookChoice?: { name: string; color: string; onPress: () => void } | null;
  /** Opens the recipe as its source worded it (app/original/[id].tsx);
   *  absent, there is no row for it. */
  onOpenOriginal?: () => void;
  /** The source's step sentences, for Step-by-Step's "From the recipe"
   *  line (StepsMode's `sourceSteps`). */
  sourceSteps?: string[] | null;
  saving?: boolean;
  /** Rendered under the mode tabs in both views, for a wrapper that needs
   *  a line there without reaching into this screen (the demo's coach line
   *  lived here until the guided demo's card replaced it, Sep 29). */
  above?: React.ReactNode;
  /** Replaces the Overview hint below the diagram (the demo's legend). */
  overviewFooter?: React.ReactNode;
  /** The saved entry, for its photo at the top of both views (a draft has
   *  none). */
  photoEntry?: Pick<Entry, 'id' | 'photo' | 'recipe'> | null;
  /** Which view is up, for the route: the diagram scrolls sideways, and a
   *  swipe on it at its left edge must not be iOS's swipe-back. */
  onViewChange?: (view: 'overview' | 'cook') => void;
  /** Which view is up and which view a step was ticked in, for the
   *  anonymous cooking counts (lib/cookCounters.ts). Only the saved
   *  recipe's route passes it; a preview and the demo count nothing. */
  onActivity?: (a: CookActivity) => void;
  /** Which tab to open on, overriding the stored `mode` for THIS visit —
   *  the Recipe Box preview's "Diagram" and "Step-by-Step". Not
   *  written back: opening a recipe is not choosing a tab, and a write on
   *  every open would be a sync round trip nobody asked for. A tap on the
   *  other tab still writes, as always. */
  initialView?: 'overview' | 'cook';
  /** A cook was just STAMPED — the last step done, outside stampCooked's
   *  six-hour window — from the diagram or from Cook mode alike. The route
   *  asks for a rating here (the Recipe Box's finish prompt). */
  onCooked?: () => void;
  /** The recipe's own rating control, when the route wants to hear about
   *  it (a change to 👎 asks whether to take it out of the box). Without
   *  it the rating is simply written. */
  onRate?: (rating: number | null) => void;
  /** The demo guide pointing at something (lib/spotlight.ts): cells by id,
   *  the Step-by-Step tab as 'mode:steps', Next step as 'cook:next'. The
   *  screen draws the ring; the guide never reaches into it. */
  spotlight?: Spotlight | null;
  /** The tab follows `mode` whenever it changes, not only on the first
   *  render: the demo's guide sets it (Back to a Diagram step, Replay).
   *  Off for a saved recipe, where another device's mode is not a reason
   *  to switch tabs under someone. */
  modeControlled?: boolean;
}

type ViewMode = 'overview' | 'cook';

/** Deep enough that undo is a real safety net, bounded so a long editing
 *  session cannot grow without limit. */
const UNDO_LIMIT = 50;

export function RecipeScreen({
  recipe,
  done,
  servings,
  timer,
  cooked,
  rating,
  notes,
  mode,
  order = null,
  onUpdate: onUpdateProp,
  canEdit = true,
  request = null,
  notice,
  onDismissNotice,
  offlineQueued,
  isDraft,
  onSave,
  onEditTitle,
  draftNote = null,
  bookChoice,
  onOpenOriginal,
  sourceSteps = null,
  saving,
  above,
  overviewFooter,
  photoEntry = null,
  onViewChange,
  onActivity,
  initialView,
  onCooked,
  onRate,
  spotlight = null,
  modeControlled = false,
}: RecipeScreenProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const toast = useToast();
  const untitled = !!isDraft && titleProblem(recipe.title) !== null;
  // A preview keeps nothing: checking a step, a timer or a card order on it
  // would be progress with nowhere to go. Those taps used to be swallowed
  // silently, which read as broken; now they say why (Sep 25). Servings
  // still work — they are how someone sizes a recipe before saving it.
  const onUpdate = useCallback(
    (patch: EntryPatch) => {
      if (isDraft && ('done' in patch || 'timer' in patch || 'order' in patch || 'cooked' in patch)) {
        toast({ message: 'Save the recipe to check off steps.' });
        return;
      }
      onUpdateProp(patch);
    },
    [isDraft, onUpdateProp, toast]
  );
  // The stored mode picks the opening tab; a tap writes it back so the next
  // open (and the other device) lands where this one left off.
  const [view, setView] = useState<ViewMode>(initialView ?? (mode === 'steps' ? 'cook' : 'overview'));
  useEffect(() => {
    onViewChange?.(view);
    onActivity?.({ kind: 'view', view });
  }, [view, onViewChange, onActivity]);
  useEffect(() => {
    if (modeControlled) setView(mode === 'steps' ? 'cook' : 'overview');
  }, [mode, modeControlled]);
  // Cook mode keeps the screen on while it is showing (lib/keepAwake.ts).
  useKeepAwakeWhile(view === 'cook');
  const pickView = (v: ViewMode) => {
    setView(v);
    if (v === 'cook') stopEditing();
    if (!isDraft && v !== (mode === 'steps' ? 'cook' : 'overview')) onUpdate({ mode: v === 'cook' ? 'steps' : 'diagram' });
  };

  /**
   * Edit mode. Ephemeral like `view`: opening another recipe lands back in
   * cooking mode, which is the mode someone opening a recipe is nearly
   * always in. Undo is multi-level because it costs almost nothing — every
   * edit already produces a whole new Recipe, so the stack is just the
   * previous ones — bounded so a long session cannot grow without limit.
   */
  const [editing, setEditing] = useState(false);
  const [sheetFor, setSheetFor] = useState<EditTarget | null>(null);
  const [undoStack, setUndoStack] = useState<Array<{ recipe: Recipe; done: string[] }>>([]);
  const [editError, setEditError] = useState<string | null>(null);
  // The ⋮ menu's requests. Keyed on the counter, so the same request made
  // twice acts twice, and a re-render with the old one acts never.
  const [servingsOpen, setServingsOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [openReorder, setOpenReorder] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // The step whose note is open. Kept after the sheet closes (the flag is
  // separate) so its title does not blank out while the sheet fades.
  const [stepNoteFor, setStepNoteFor] = useState<{ stepId: string; label: string } | null>(null);
  const [stepNoteOpen, setStepNoteOpen] = useState(false);
  const openStepNote = (stepId: string, label: string) => {
    setStepNoteFor({ stepId, label });
    setStepNoteOpen(true);
  };
  // Clear progress asks first: it wipes every check on the recipe, and the
  // button sits where a thumb reaches for other things.
  const [confirmClear, setConfirmClear] = useState(false);
  // Each confirmed Clear: Step-by-Step, if it is on screen, goes back to
  // its first card (lib/cookReset.ts says why nothing else needs telling).
  const [clearCount, setClearCount] = useState(0);
  // Each Undo of a Clear: Step-by-Step goes back to where a fresh mount
  // would start, which for a finished cook is the finished card.
  const [resumeCount, setResumeCount] = useState(0);
  useEffect(() => {
    if (!request?.n || !canEdit) return;
    if (request.kind === 'edit') {
      setView('overview');
      setEditing(true);
    } else if (request.kind === 'reorder') {
      pickView('cook');
      setOpenReorder(true);
    } else if (request.kind === 'servings') {
      setServingsOpen(true);
    } else if (request.kind === 'rating') {
      setRatingOpen(true);
    } else if (request.kind === 'notes') {
      setNotesOpen(true);
    } else if (request.kind === 'clear') {
      // Progress only, exactly as the confirmed Clear below.
      onUpdate(clearProgressPatch());
      setClearCount((c) => c + 1);
    } else if (request.kind === 'resume') {
      setResumeCount((c) => c + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);


  // The diagram's press-and-hold drag: the page must not scroll under it,
  // and it scrolls the page itself while the finger is near an edge. The
  // offsets are refs because a drag reads them on every tick.
  const [dragging, setDragging] = useState(false);
  const overviewRef = useRef<ScrollView>(null);
  const pageY = useRef(0);
  const pageContentH = useRef(0);
  const pageViewH = useRef(0);
  // What the demo guide rings is brought into view (components/demo/reveal).
  const revealInPage = useMemo(() => makeReveal(overviewRef, pageY), []);
  const scrollPageBy = (dy: number): number => {
    const max = Math.max(0, pageContentH.current - pageViewH.current);
    const next = Math.min(max, Math.max(0, pageY.current + dy));
    const moved = next - pageY.current;
    if (moved === 0) return 0;
    overviewRef.current?.scrollTo({ y: next, animated: false });
    pageY.current = next;
    return moved;
  };

  // countDone, never done.length: a ticked section header ("Oven 425°F")
  // is in `done` and is never part of the total.
  const doneCount = countDone(done);
  const total = countAll(recipe);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const scale = servings && recipe.servings ? servings / recipe.servings : 1;

  const toggle = (id: string) => {
    const next = toggleDone(recipe, done, id);
    const stamped = stampCooked(cooked, doneCount, countDone(next), total);
    onUpdate(stamped === cooked ? { done: next } : { done: next, cooked: stamped });
    if (countDone(next) > doneCount) onActivity?.({ kind: 'tick', view, finished: stamped !== cooked });
    if (asksForRating(cooked, stamped)) onCooked?.();
  };
  /** Cook mode's "Next Step": done (if not already) and the step's timer
   *  cleared, as one write — see StepsMode's onMarkDone. */
  const markDone = (stepId: string) => {
    const next = doneSet.has(stepId) ? done : toggleDone(recipe, done, stepId);
    const stamped = stampCooked(cooked, doneCount, countDone(next), total);
    const patch: EntryPatch = { done: next };
    if (stamped !== cooked) patch.cooked = stamped;
    if (timer?.stepId === stepId) patch.timer = null;
    onUpdate(patch);
    if (countDone(next) > doneCount) onActivity?.({ kind: 'tick', view, finished: stamped !== cooked });
    if (asksForRating(cooked, stamped)) onCooked?.();
  };
  const doneSet = useMemo(() => new Set(done), [done]);
  // Scaled servings are the one thing moved to the menu that changes what
  // is on screen — every amount — so when they are not the recipe's own,
  // the page says so, and the line opens the stepper.
  const scaledNote =
    servings && recipe.servings && servings !== recipe.servings
      ? `Cooking for ${servings} · the recipe makes ${recipe.servings}`
      : null;
  // The source's own wording, one tap from either view: below the diagram
  // (an SE has no room above it left to spend — CLAUDE.md, the recipe
  // screen headroom), and below the card in Step-by-Step, where the card
  // shows only its own share of a source step.
  const originalRow =
    onOpenOriginal && !editing ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Original recipe, as the source wrote it"
        onPress={onOpenOriginal}
        style={({ pressed }) => [styles.originalRow, pressed && styles.originalRowPressed]}
        testID="recipe-original"
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.originalTitle}>Original recipe</Text>
          <Text style={styles.originalSub} numberOfLines={1}>
            The ingredients and steps as {recipe.sourceUrl ? recipe.source || 'the page' : 'the source'} wrote them
          </Text>
        </View>
        <Text style={styles.originalChevron}>›</Text>
      </Pressable>
    ) : null;

  /**
   * The person's own notes (Oct 2, user feedback item 1): a saved recipe
   * only — a preview has no row to keep them on and the demo is not
   * anybody's. Three places, none of them above the diagram unless it is
   * free: a one-line strip at the top of the diagram view where it costs
   * the diagram nothing (lib/notesStrip.ts), the whole note under the
   * diagram, and the note leading Step-by-Step's first card. A step's own
   * note is on that step's card, where it is written, and listed under the
   * diagram after the recipe's.
   */
  const notesOn = notes !== undefined && canEdit && !isDraft;
  const noteText = notesText(notes);
  const { width: winW, height: winH } = useWindowDimensions();
  const noteStrip =
    notesOn && noteText && noteStripFits({ windowHeight: winH, photoSize: photoEntry?.photo ? thumbSize(winW) : null, scaled: !!scaledNote }) ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Your notes: ${noteText}`}
        accessibilityHint="Opens your notes to edit them."
        onPress={() => setNotesOpen(true)}
        style={({ pressed }) => [styles.noteStrip, pressed && styles.originalRowPressed]}
        testID="recipe-note-strip"
      >
        <Feather name="edit-3" size={14} color={colors.mutedForeground} />
        <Text style={styles.noteStripText} numberOfLines={1}>
          {notesPreview(notes)}
        </Text>
      </Pressable>
    ) : null;
  const notesRow =
    notesOn && !editing ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={noteText ? `Your notes: ${noteText}. Edit` : 'Add a note to this recipe'}
        onPress={() => setNotesOpen(true)}
        style={({ pressed }) => [styles.originalRow, pressed && styles.originalRowPressed]}
        testID="recipe-notes"
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.originalTitle}>{noteText ? 'Your notes' : 'Add a note'}</Text>
          {noteText ? (
            <Text style={styles.notesBody}>{noteText}</Text>
          ) : (
            <Text style={styles.originalSub}>Your own changes and reminders. Only you see them.</Text>
          )}
        </View>
        {noteText ? <Text style={styles.notesEdit}>Edit</Text> : <Feather name="plus" size={20} color={colors.mutedForeground} />}
      </Pressable>
    ) : null;
  const stepNoteRows =
    notesOn && !editing && notes
      ? stepNotesInOrder(notes, recipe).map(({ stepId, label, text }) => (
          <Pressable
            key={stepId}
            accessibilityRole="button"
            accessibilityLabel={`Your note on ${label}: ${text}. Edit`}
            onPress={() => openStepNote(stepId, label)}
            style={({ pressed }) => [styles.originalRow, pressed && styles.originalRowPressed]}
            testID="recipe-step-note"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.originalSub}>On the step “{label}”</Text>
              <Text style={styles.notesBody}>{text}</Text>
            </View>
            <Text style={styles.notesEdit}>Edit</Text>
          </Pressable>
        ))
      : null;
  const notesRows =
    notesRow || stepNoteRows?.length ? (
      <>
        {notesRow}
        {stepNoteRows}
      </>
    ) : null;
  const leadNote =
    notesOn && noteText ? (
      <View style={styles.leadNote} testID="cook-note">
        <Text style={styles.leadNoteLabel}>Your notes</Text>
        <Text style={styles.notesBody}>{noteText}</Text>
      </View>
    ) : null;

  /** The top of both views: the recipe's picture and Clear progress, and
   *  nothing else (Sep 25) — plus, in the diagram view, the note strip
   *  where it fits. Saved recipes only — the demo has its own Reset, and a
   *  preview has neither a picture nor progress. */
  const sessionRowFor = (strip: React.ReactNode) => canEdit ? (
    <View style={styles.sessionRow} testID="recipe-session">
      {photoEntry ? <RecipePhotoThumb entry={photoEntry} /> : null}
      <View style={styles.sessionMain}>
        <SheetButton label="Clear progress" onPress={() => setConfirmClear(true)} disabled={done.length === 0 && !timer} testID="recipe-clear" />
        {strip}
        {scaledNote ? (
          <Pressable accessibilityRole="button" onPress={() => setServingsOpen(true)} style={styles.scaledNote} testID="recipe-scaled">
            <Text style={styles.scaledNoteText}>{scaledNote}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;

  /**
   * Applies one edit, immediately. No Save button: the change is the save.
   * The candidate is validated before it is kept, the previous tree goes on
   * the undo stack, and a server rejection rolls back through the sync
   * engine's notice. `done` is reconciled through shared/progress.ts, so
   * an op that deletes something can never leave a stale id behind.
   * Correcting what the recipe MAKES clears tonight's servings: "8" against
   * a base of 4 meant double, and against a corrected base of 6 it would
   * silently mean 1.33x — every amount moving because of an edit to a
   * different field.
   */
  const applyOp = useCallback(
    (op: EditOp) => {
      let next: Recipe;
      try {
        next = applyEdit(recipe, op);
      } catch (e) {
        setEditError((e as Error).message);
        return;
      }
      const problems = validateRecipe(next);
      if (problems.length) {
        // The sheet checks before calling, so reaching here means something
        // upstream is wrong rather than that the user typed something odd.
        setEditError(problems[0]);
        return;
      }
      const reconciled = reconcileDone(next, done);
      setUndoStack((prev) => [...prev, { recipe, done }].slice(-UNDO_LIMIT));
      const clearsServings = op.type === 'setRecipeFields' && 'servings' in op.fields;
      const patch: EntryPatch = { recipe: next, done: reconciled.done };
      if (clearsServings) patch.servings = null;
      onUpdate(patch);
      // Structural ops close the sheet: a section index or a deleted id must
      // not outlive the tree it came from.
      if (op.type !== 'setIngredientFields' && op.type !== 'setStepFields' && op.type !== 'setRecipeFields' && op.type !== 'setSectionFields' && op.type !== 'reorderInputs') {
        setSheetFor(null);
      }
    },
    [recipe, done, onUpdate]
  );

  const undo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    onUpdate({ recipe: last.recipe, done: last.done });
  }, [undoStack, onUpdate]);

  const stopEditing = () => {
    setEditing(false);
    setSheetFor(null);
    setEditError(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        {isDraft ? (
          // Unmissable, and on both views: a preview is thrown away the moment
          // someone leaves it, and the Save bar alone did not say so.
          <View style={styles.draftBanner} accessibilityRole="alert" testID="draft-banner">
            <Text style={styles.draftBannerText}>
              <Text style={styles.draftBannerStrong}>Preview — not saved.</Text> Save it to keep it and to check off steps.
              Leaving this screen or closing the app discards it.
            </Text>
            {draftNote ? (
              <Text style={[styles.draftBannerText, styles.draftBannerStrong]} testID="draft-note">
                {draftNote}
              </Text>
            ) : null}
            {onEditTitle ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={untitled ? 'Give this recipe a title' : `Title: ${recipe.title}. Rename`}
                onPress={onEditTitle}
                style={({ pressed }) => [styles.draftTitleRow, pressed && styles.draftTitleRowPressed]}
                testID="draft-title"
              >
                <Text style={[styles.draftTitle, untitled && styles.draftTitleBlank]} numberOfLines={2}>
                  {untitled ? 'No title yet — tap to add one' : recipe.title}
                </Text>
                <Feather name="edit-2" size={16} color={colors.warmInk} />
                <Text style={styles.draftTitleAction}>{untitled ? 'Add' : 'Rename'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
          <ModeTab label="Diagram" active={view === 'overview'} onPress={() => pickView('overview')} colors={colors} />
          <ModeTab
            label="Step-by-Step"
            active={view === 'cook'}
            onPress={() => pickView('cook')}
            colors={colors}
            spot={!!spotlight?.targets.has('mode:steps')}
            pointer={pointerFor(spotlight, 'mode:steps')}
          />
        </View>
      </View>

      {above ? <View style={styles.above}>{above}</View> : null}

      {offlineQueued && !notice ? (
        <View style={styles.queuedBanner} accessibilityLiveRegion="polite" testID="offline-banner">
          <Text style={styles.queuedText}>No connection. Your progress here is kept and will save when it returns.</Text>
        </View>
      ) : null}

      {notice ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{notice}</Text>
          {onDismissNotice ? <SheetButton label="Dismiss" onPress={onDismissNotice} /> : null}
        </View>
      ) : null}

      {view === 'overview' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          ref={overviewRef}
          contentContainerStyle={styles.scrollContent}
          scrollEnabled={!dragging}
          onScroll={(e) => {
            pageY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onContentSizeChange={(_w, h) => {
            pageContentH.current = h;
          }}
          onLayout={(e) => {
            pageViewH.current = e.nativeEvent.layout.height;
          }}
          testID="recipe-overview"
        >
          {!editing ? sessionRowFor(noteStrip) : null}
          {/* The mode has to announce itself. Someone who wanders into edit
              mode and taps around must not be left wondering why nothing
              checks off — so the bar is persistent, not a toast. The
              recipe's own fields have no cell to tap, so they live here. */}
          {editing ? (
            <View style={styles.editBar} accessibilityRole="summary" testID="edit-bar">
              <View style={styles.editDot} />
              <Text style={styles.editText}>
                <Text style={styles.editStrong}>Editing.</Text> Tap a cell or a section title to change it. Nothing is being checked off.
              </Text>
              <View style={styles.editActions}>
                <SheetButton label="Recipe…" onPress={() => setSheetFor({ kind: 'recipe' })} testID="edit-recipe" />
                <SheetButton label="Undo" disabled={undoStack.length === 0} onPress={undo} testID="edit-undo" />
                <SheetButton label="Done" onPress={stopEditing} testID="edit-done" />
              </View>
            </View>
          ) : null}
          {editError ? (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.noticeText}>{editError}</Text>
              <SheetButton label="Dismiss" onPress={() => setEditError(null)} />
            </View>
          ) : null}
          <RevealContext.Provider value={spotlight ? revealInPage : null}>
            <DiagramView
              recipe={recipe}
              done={doneSet}
              onToggle={toggle}
              scale={scale}
              spotlight={spotlight}
              edit={
                editing
                  ? {
                      onTapCell: (id) => setSheetFor({ kind: 'node', id }),
                      onTapSection: (index) => setSheetFor({ kind: 'section', index }),
                      onMove: (ingredientId, toStepId) => applyOp({ type: 'moveIngredient', ingredientId, toStepId }),
                      onBlocked: setEditError,
                      onDragChange: setDragging,
                      scrollPageBy,
                    }
                  : null
              }
            />
          </RevealContext.Provider>
          {/* Edit mode only (Oct 1): the line explaining amber and jumping
              ahead is gone from a saved recipe — the guided demo teaches
              both — and edit mode keeps its line because it must never be
              quiet (CLAUDE.md, the visual editor). */}
          {overviewFooter ??
            (editing ? (
              <Text style={styles.hint}>
                Changes save as you make them. Press and hold an ingredient to move it to another step. Undo reverses the last one.
              </Text>
            ) : null)}
          {/* The source's own wording, one tap from the diagram that is our
              reading of it. Below the diagram, not above: an SE has no room
              above it left to spend (CLAUDE.md, the recipe screen headroom). */}
          {notesRows}
          {originalRow}
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
          canReorder={canEdit && !isDraft}
          onSetOrder={(next) => onUpdate({ order: next })}
          openReorder={openReorder}
          onReorderOpened={() => setOpenReorder(false)}
          header={sessionRowFor(null)}
          leadNote={leadNote}
          stepNotes={notesOn ? { textFor: (id) => stepNote(notes, id), onEdit: openStepNote } : null}
          sourceSteps={sourceSteps}
          footer={
            notesRows || originalRow ? (
              <>
                {notesRows}
                {originalRow}
              </>
            ) : null
          }
          resetSignal={clearCount}
          resumeSignal={resumeCount}
          spotlightNext={!!spotlight?.targets.has('cook:next')}
          pointerNext={pointerFor(spotlight, 'cook:next')}
        />
      )}

      {editing ? <EditSheet recipe={recipe} target={sheetFor} onApply={applyOp} onClose={() => setSheetFor(null)} /> : null}

      {/* ⋮ › Servings: tonight's quantity, which scales every amount.
          `entry.servings` only — never the recipe's own number (CLAUDE.md). */}
      <Sheet open={servingsOpen} title="Servings" onClose={() => setServingsOpen(false)}>
        <ServingsRow
          base={recipe.servings}
          entryServings={servings}
          yieldText={recipe.yieldText}
          onChange={(next) => onUpdate({ servings: next })}
        />
        {typeof recipe.servings !== 'number' || recipe.servings <= 0 ? (
          <SheetNote>This recipe does not say how many it serves, so it cannot be scaled.</SheetNote>
        ) : null}
      </Sheet>

      {/* ⋮ › Rating: offered once the recipe has been cooked (before that
          it would be an opinion about a web page). */}
      <Sheet open={ratingOpen} title="Rating" onClose={() => setRatingOpen(false)}>
        <View style={styles.ratingSheet}>
          <RatingControl rating={rating} onChange={(r) => (onRate ? onRate(r) : onUpdate({ rating: r }))} />
        </View>
      </Sheet>

      {/* ⋮ › Notes, the strip and the notes row. Saved on close. */}
      {notesOn ? (
        <NotesSheet
          open={notesOpen}
          title="Notes"
          value={noteText}
          maxLength={NOTE_MAX}
          placeholder="Your changes and reminders: less salt, a swap, how long it really took…"
          accessibilityLabel="Your notes on this recipe"
          onSave={(text) => onUpdate({ notes: cleanNotes(text, notes) })}
          onClose={() => setNotesOpen(false)}
        />
      ) : null}
      {/* A step's own note, from its card or its row under the diagram. */}
      {notesOn && stepNoteFor ? (
        <NotesSheet
          open={stepNoteOpen}
          title="Step note"
          context={`On “${stepNoteFor.label}”`}
          value={stepNote(notes, stepNoteFor.stepId)}
          maxLength={STEP_NOTE_MAX}
          placeholder="For this step: which pan, how long it really took, what you'd change…"
          accessibilityLabel={`Your note on the step ${stepNoteFor.label}`}
          onSave={(text) => onUpdate({ notes: withStepNote(notes, stepNoteFor.stepId, text) })}
          onClose={() => setStepNoteOpen(false)}
        />
      ) : null}

      {/* A window, like the delete confirmation: it asks something. */}
      <Window open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth={400} testID="clear-window">
        <Text style={styles.confirmHeading} accessibilityRole="header">
          Clear all progress on this recipe?
        </Text>
        <Text style={styles.confirmBody}>Every checked step is unchecked and any running timer stops. This can't be undone.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Progress only: the cooking history and the rating are the
            // recipe's record, not tonight's, and stay.
            onUpdate(clearProgressPatch());
            setClearCount((n) => n + 1);
            setConfirmClear(false);
          }}
          style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.85 }]}
          testID="clear-confirm"
        >
          <Text style={styles.dangerBtnText}>Clear</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmClear(false)}
          style={({ pressed }) => [styles.keepBtn, pressed && { borderColor: colors.borderStrong }]}
          testID="clear-cancel"
        >
          <Text style={styles.keepBtnText}>Cancel</Text>
        </Pressable>
      </Window>

      {isDraft ? (
        <View style={[styles.saveBar, bookChoice ? styles.saveBarRow : null]}>
          {bookChoice ? (
            // The book, one tap from Save: the default is the extraction's
            // meal-type guess, so the common case never opens this.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Book: ${bookChoice.name}. Change book`}
              onPress={bookChoice.onPress}
              style={({ pressed }) => [styles.bookChip, pressed && { opacity: 0.85 }]}
              testID="draft-book"
            >
              <View style={[styles.bookDot, { backgroundColor: bookChoice.color }]} />
              <Text style={styles.bookChipText} numberOfLines={1}>
                {bookChoice.name}
              </Text>
              <Feather name="chevron-down" size={16} color={colors.foreground} />
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.saveButton, bookChoice ? styles.saveButtonFlex : null]}
            // A blank title is asked for, not refused: Save opens the
            // title window, and saving is one more tap from there.
            onPress={untitled && onEditTitle ? onEditTitle : onSave}
            disabled={saving}
            accessibilityRole="button"
            testID="draft-save"
          >
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
  spot = false,
  pointer = null,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
  /** The demo guide is pointing at this tab. */
  spot?: boolean;
  /** "Watch instead"'s pointer, when it is on this tab. */
  pointer?: Pointer | null;
}) {
  // The app's language for "one of these" (SheetOption: the Books/Grid
  // choice, the meal types): both segments are filled, bordered controls,
  // and the current one is the cool tint. The first cut was a dark pill
  // beside bare text, and the bare one did not read as tappable (Sep 25).
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityHint={spot ? 'Highlighted by the demo.' : undefined}
      testID={`mode-${label === 'Diagram' ? 'diagram' : 'steps'}`}
      style={({ pressed }) => [
        styles2.tab,
        active
          ? { backgroundColor: colors.coolBg, borderColor: colors.coolLine }
          : { backgroundColor: colors.card, borderColor: pressed ? colors.borderStrong : colors.border },
        pressed && !active && { backgroundColor: colors.muted },
      ]}
    >
      <Text style={{ color: active ? colors.coolInk : colors.foreground, fontFamily: active ? fonts.heading : fonts.headingMedium, fontSize: 15 }}>
        {label}
      </Text>
      {spot ? <SpotRing radius={12} /> : null}
      {pointer ? <TapPointer pointer={pointer} /> : null}
    </Pressable>
  );
}
const styles2 = StyleSheet.create({
  // 44px is the touch-target floor (CLAUDE.md); the scaffold's 40px tab was
  // a desktop button that happened to be on a phone.
  tab: { flex: 1, minHeight: 48, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
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
    confirmHeading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    confirmBody: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    // The delete confirmation's red, fixed in both themes (app/recipe/[id].tsx).
    dangerBtn: { marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#92351b' },
    dangerBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
    keepBtn: { marginTop: 8, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    keepBtnText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    above: { paddingHorizontal: 20 },
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
    queuedBanner: {
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 9,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    queuedText: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
    sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    sessionMain: { flex: 1, alignItems: 'flex-end', gap: 6 },
    scaledNote: { minHeight: 44, justifyContent: 'center' },
    scaledNoteText: { fontSize: 13, color: colors.coolInk, textAlign: 'right', textDecorationLine: 'underline' },
    ratingSheet: { alignItems: 'flex-start', paddingVertical: 4 },
    // .rd-editbar: cool tint, cool line, persistent.
    editBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.coolBg,
      borderWidth: 1,
      borderColor: colors.coolLine,
      borderRadius: colors.radiusButton,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 14,
    },
    editDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coolInk },
    editText: { flex: 1, minWidth: 200, fontSize: 13.5, lineHeight: 19, color: colors.coolInk },
    editStrong: { fontWeight: '700' },
    editActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    hint: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, marginTop: 12, marginBottom: 14 },
    source: { minHeight: 44, justifyContent: 'center', marginBottom: 8 },
    originalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    originalRowPressed: { borderColor: colors.borderStrong, backgroundColor: colors.muted },
    originalTitle: { fontFamily: fonts.heading, fontSize: 15, color: colors.foreground },
    // The person's own notes: body size, readable across a counter.
    notesBody: { fontSize: 15, lineHeight: 21, color: colors.foreground, marginTop: 4 },
    notesEdit: { fontFamily: fonts.heading, fontSize: 14, color: colors.warmLine, marginLeft: 8, alignSelf: 'flex-start', paddingTop: 2 },
    // One line under Clear progress, the full width of the column; 44pt.
    noteStrip: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 10,
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    noteStripText: { flex: 1, fontSize: 14, color: colors.foreground },
    // Above Step-by-Step's first card: the note is read before anything
    // goes in a pan.
    leadNote: {
      marginBottom: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    leadNoteLabel: { fontSize: 12.5, fontWeight: '600', color: colors.mutedForeground },
    originalSub: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    originalChevron: { fontSize: 22, color: colors.mutedForeground, marginLeft: 8 },
    sourceText: { fontSize: 12, color: colors.faint },
    sourceLink: { color: colors.mutedForeground, textDecorationLine: 'underline' },
    draftBanner: {
      borderWidth: 2,
      borderColor: colors.warmLine,
      backgroundColor: colors.warmBg,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    draftBannerText: { fontSize: 14, lineHeight: 20, color: colors.warmInk },
    draftBannerStrong: { fontFamily: fonts.heading },
    // The preview's title, and the way to change it: a full-width 44pt row
    // at the foot of the banner, so it reads as part of "not saved yet".
    draftTitleRow: {
      marginTop: 8,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.warmLine,
      backgroundColor: colors.card,
    },
    draftTitleRowPressed: { backgroundColor: colors.muted },
    draftTitle: { flex: 1, fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground, paddingVertical: 6 },
    draftTitleBlank: { color: colors.warmInk },
    draftTitleAction: { fontSize: 14, fontWeight: '600', color: colors.warmInk },
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
    saveBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    saveButtonFlex: { flex: 1 },
    bookChip: {
      flexShrink: 1,
      maxWidth: '46%',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
    },
    bookDot: { width: 14, height: 14, borderRadius: 7 },
    bookChipText: { flexShrink: 1, fontSize: 15, fontFamily: fonts.headingMedium, color: colors.foreground },

  });
}
