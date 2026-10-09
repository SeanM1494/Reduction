/**
 * app/recipe/[id].tsx — one recipe, saved or freshly extracted.
 *
 * id === "draft" shows the just-extracted, not-yet-saved recipe held in
 * LibraryContext's transient `draft` slot (see lib/library-context.tsx) and
 * offers a Save button; its servings stepper works but lives in local state,
 * because there is no row to write to yet. Any other id looks up a saved
 * entry and writes straight through `useLibrary().update` — the patch plus
 * `ifVersion`, and the three-way merge on a 409.
 *
 * This route owns the header (title, the ⋮ overflow menu) and the sheets the
 * menu reaches — meal types, the delete confirmation — because the same
 * meal-type sheet is also opened from the badge inside RecipeScreen.
 *
 * A write the server refused is rolled back by the sync engine and shown
 * here as a notice until dismissed — as is a conflict it resolved against
 * another device: an edit that silently vanishes is the worst thing this
 * screen can produce (see the web's "Writes are confirmed, not assumed").
 */

import { ShoppingCartButton } from '@/components/shopping/ShoppingCartButton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Feather } from '@expo/vector-icons';
import { useLibrary, type EntryPatch } from '@/lib/library-context';
import { RecipeScreen, type RecipeRequest } from '@/components/RecipeScreen';
import { MealTypeSheet } from '@/components/recipe/MealTypeSheet';
import { Window } from '@/components/Window';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { PhotoSheet } from '@/components/recipe/PhotoSheet';
import { FinishPrompt, type FinishStage } from '@/components/recipeBox/FinishPrompt';
import { useToast } from '@/components/Toast';
import { asksToRemove, clearedToast, keptToast, removedToast } from '@/lib/recipeBox';
import { useBooks } from '@/lib/books-context';
import { useShoppingList } from '@/lib/shopping-context';
import { loadOriginal, type Entry } from '@/lib/api';
import { originalStepTexts } from '@/shared/original';
import { hasStepSources } from '@/shared/stepSource';
import { applyEdit } from '@/shared/edits';
import { TitleWindow } from '@/components/TitleWindow';
import { TitleButton } from '@/components/recipe/TitleButton';
import { freeRecipeLine, savedCounter, usesFreeRecipe } from '@/lib/reelView';
import { reportCounter } from '@/lib/api';
import { createCookVisit, type CookActivity, type CookVisit } from '@/lib/cookCounters';
import { maybeAskForRating, noteFinishedCook } from '@/lib/ratingPrompt';
import { BookPicker } from '@/components/books/BookPicker';
import { titleProblem } from '@/shared/title';
import { recipeHasAltUnits } from '@/shared/amounts';
import { flipUnitPref, useUnitPref } from '@/lib/unitPref';
import { flipLabel, flipTarget } from '@/lib/unitPrefPolicy';

export default function RecipeDetailScreen() {
  // `view` is the Recipe Box preview's choice of tab for this visit.
  const { id, view: viewParam } = useLocalSearchParams<{ id: string; view?: string }>();
  const initialView = viewParam === 'cook' || viewParam === 'overview' ? viewParam : undefined;
  const colors = useColors();
  const unitPref = useUnitPref();
  const styles = makeStyles(colors);
  const { draft, setDraft, getEntry, update, remove, restore, saveRecipe, notice, clearNotice, queued } = useLibrary();
  const toast = useToast();
  const { bookFor, available: booksAvailable, live: liveBooks } = useBooks();
  // The Recipe Box's finish prompt: 'rate' when a cook is stamped, 'remove'
  // after a 👎, 'reset' (start fresh?) after either unless the recipe was
  // removed. Remove closes it instantly, because it navigates.
  const [finish, setFinish] = useState<FinishStage | null>(null);
  const [finishInstant, setFinishInstant] = useState(false);
  const ask = (stage: FinishStage) => {
    setFinishInstant(false);
    setFinish(stage);
  };
  const { refresh: refreshAccount, entitlement } = useAuth();
  const [saving, setSaving] = useState(false);
  const [draftServings, setDraftServings] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { view: shoppingView, openAddToList } = useShoppingList();
  const shoppingCount = shoppingView.items.length;
  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Rename (saved, from ⋮) and the preview's title: one window, one rule.
  const [titleOpen, setTitleOpen] = useState(false);
  // Which book: the preview's choice before Save, and ⋮ › Move to another
  // book after. One picker, two callers.
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [draftBook, setDraftBook] = useState<string | null>(null);
  // "Edit recipe" in the menu opens edit mode in RecipeScreen, which owns it.
  // ⋮ requests for the recipe screen (RecipeScreen's `request`).
  const [request, setRequest] = useState<RecipeRequest | null>(null);
  const askScreen = (kind: RecipeRequest['kind']) => setRequest((r) => ({ kind, n: (r?.n ?? 0) + 1 }));
  // What a menu item opens once the menu has finished closing.
  const afterMenu = useRef<(() => void) | null>(null);
  const menuThen = (next: () => void) => {
    afterMenu.current = next;
    setMenuOpen(false);
  };
  const [deleting, setDeleting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // NO SWIPE-BACK ON THIS SCREEN, in either view. The diagram scrolls
  // sideways, and at its leftmost position a swipe to the right on it is,
  // to iOS, the interactive pop gesture: the screen went back to the library
  // under a finger that was reading a table (Sep 21). It was left on for
  // Step-by-Step, which has nothing horizontal — and a thumb brushing the
  // edge while cooking popped that screen too (Sep 25, a real phone). A
  // recipe is where the hands are busy; the header's back button is the way
  // out.

  const isDraft = id === 'draft';
  const entry = isDraft ? null : getEntry(id);
  // One visit to a saved recipe, for the anonymous cooking counts
  // (lib/cookCounters.ts). Made on first use for this id, from whichever
  // fires first: RecipeScreen's effects run before this route's.
  const visit = useRef<{ id: string; v: CookVisit } | null>(null);
  const visitFor = useCallback((rid: string) => {
    if (visit.current?.id !== rid) visit.current = { id: rid, v: createCookVisit(reportCounter) };
    return visit.current.v;
  }, []);
  const hasEntry = !!entry;
  useEffect(() => {
    if (!isDraft && hasEntry) visitFor(id).opened();
  }, [id, isDraft, hasEntry, visitFor]);
  // A finished cook here asks for a rating as the screen is LEFT, never
  // mid-cook (lib/rating.ts has the rules; ratingPrompt.ts does nothing on
  // a binary without the native module).
  const finishedHere = useRef(false);
  const onActivity = useCallback(
    (a: CookActivity) => {
      visitFor(id).activity(a);
      if (a.kind === 'tick' && a.finished) {
        finishedHere.current = true;
        void noteFinishedCook();
      }
    },
    [id, visitFor],
  );
  useEffect(
    () => () => {
      const finished = finishedHere.current;
      // After the pop has finished, so Apple's sheet lands on the library.
      if (finished) setTimeout(() => void maybeAskForRating(true), 700);
    },
    [],
  );

  // The recipe's own step sentences, for Step-by-Step (StepsMode's
  // `sourceSteps`). Asked for only when the recipe's steps carry source
  // numbers — every recipe saved before them has nothing to caption — and
  // kept with the id it was fetched FOR, so a reply for another recipe is
  // never shown on this one.
  const [sourceFor, setSourceFor] = useState<{ id: string; steps: string[] } | null>(null);
  const tagged = !isDraft && !!entry && hasStepSources(entry.recipe);
  useEffect(() => {
    if (!tagged || !id || sourceFor?.id === id) return;
    let live = true;
    loadOriginal(id)
      .then((r) => live && setSourceFor({ id, steps: originalStepTexts(r.original) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tagged, id, sourceFor?.id]);
  const savedSourceSteps = sourceFor?.id === id ? sourceFor.steps : null;

  // LEAVING A PREVIEW ASKS (Sep 25). The draft lives in memory only, so
  // back from it used to throw the recipe away without a word. Saving turns
  // the guard off first (savedId), then moves to the saved recipe from an
  // effect, so the save's own navigation is never the thing that is asked.
  //
  // Discarding works the same way: a re-dispatched action meets the same
  // guard and would be stopped again, so the guard goes off (discarding)
  // and the pending action is dispatched from an effect once it has.
  const navigation = useNavigation();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const pendingLeave = useRef<unknown>(null);
  const discardOnClose = useRef(false);
  usePreventRemove(isDraft && !!draft && !savedId && !discarding, ({ data }) => {
    pendingLeave.current = data.action;
    setLeaveOpen(true);
  });
  useEffect(() => {
    if (!savedId) return;
    setDraft(null);
    router.replace(`/recipe/${savedId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId]);
  useEffect(() => {
    if (!discarding || !pendingLeave.current) return;
    navigation.dispatch(pendingLeave.current as never);
    pendingLeave.current = null;
  }, [discarding, navigation]);
  // The preview's book: the person's pick, else where the extraction's
  // meal-type guess points (through any merge, else Other). Never asked
  // for: Save saves with whatever this is.
  const draftBookShown = draft ? bookFor({ ...draft, savedAt: 0, recipe: draft.recipe, book: draftBook }) : null;
  const saveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const saved = await saveRecipe(draft.recipe, draft.sourceKey, booksAvailable === true ? draftBookShown?.id ?? null : null);
      // The SAVE is what spends the free allowance (the server counts
      // a created row, not an extraction), so the entitlement the
      // Find tab and Settings read has to be re-read here. Without
      // this, Settings kept the old count after the first
      // recipe was already saved and counted.
      await refreshAccount();
      // Anonymous: that a starter card became a saved recipe, by kind.
      if (draft.fromReel) reportCounter(savedCounter(draft.fromReel));
      setSavedId(saved.id);
    } catch {
      // saveRecipe surfaces its own error via LibraryContext.error; the
      // draft stays put so the user can retry.
    } finally {
      setSaving(false);
    }
  };
  const recipeTitle = (isDraft ? draft?.recipe.title : entry?.recipe.title) || 'Recipe';

  // Writes go through the sync engine (lib/library-context.tsx); a refused
  // one comes back as a notice for this entry, with the rollback done.
  const write = useCallback(
    (patch: EntryPatch) => {
      if (entry) update(entry.id, patch);
    },
    [entry, update]
  );
  const entryNotice = !isDraft && notice && notice.id === id ? notice.message : null;

  if (isDraft) {
    if (!draft) {
      return (
        <View style={styles.center}>
          <Stack.Screen options={{ title: 'Recipe' }} />
          <Text style={{ color: colors.mutedForeground }}>This recipe is no longer available.</Text>
        </View>
      );
    }
    return (
      <>
        <Stack.Screen options={{ title: recipeTitle, gestureEnabled: false }} />
        <RecipeScreen
          recipe={draft.recipe}
          done={[]}
          servings={draftServings}
          timer={null}
          cooked={[]}
          rating={null}
          mode="diagram"
          canEdit={false}
          onUpdate={(patch) => {
            if ('servings' in patch) setDraftServings(patch.servings ?? null);
          }}
          isDraft
          saving={saving}
          onSave={saveDraft}
          onEditTitle={() => setTitleOpen(true)}
          // A starter's preview says what its Save spends: one of the free
          // recipes, like any save (decided Oct 1).
          draftNote={draft.fromReel && entitlement && usesFreeRecipe(entitlement) ? freeRecipeLine(entitlement) : null}
          bookChoice={
            booksAvailable === true && draftBookShown
              ? { name: draftBookShown.name, color: draftBookShown.color, onPress: () => setBookPickerOpen(true) }
              : null
          }
          // Only when the extraction brought wording: a preview has nothing
          // to fetch it from later.
          onOpenOriginal={draft.original ? () => router.push('/original/draft') : undefined}
          sourceSteps={originalStepTexts(draft.original)}
        />
        {/* The preview's title lives in the draft, in memory, and is what
            Save sends: a title typed on Add New or here is never replaced by
            the extraction's (the cache is written before the reply, and a
            save only reads it). */}
        <TitleWindow
          open={titleOpen}
          title={draft.recipe.title ?? ''}
          heading={titleProblemFree(draft.recipe.title) ? 'Rename recipe' : 'Name this recipe'}
          onSave={(title) => setDraft({ ...draft, recipe: { ...draft.recipe, title } })}
          onClose={() => setTitleOpen(false)}
        />
        <BookPicker
          open={bookPickerOpen}
          title="Save to…"
          current={draftBookShown?.id ?? null}
          onPick={(id) => {
            setDraftBook(id);
            setBookPickerOpen(false);
          }}
          onClose={() => setBookPickerOpen(false)}
        />
        <Window
          open={leaveOpen}
          onClose={() => setLeaveOpen(false)}
          onClosed={() => {
            // Left from here, after the window is gone: it is a Modal, and
            // it goes before the screen does.
            if (!discardOnClose.current) return;
            discardOnClose.current = false;
            setDiscarding(true);
          }}
          maxWidth={400}
          testID="leave-window"
        >
          <Text style={styles.confirmHeading} accessibilityRole="header">
            Leave without saving?
          </Text>
          <Text style={styles.confirmBody}>{recipeTitle} won't be kept. Save it to find it in your library later.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLeaveOpen(false);
              void saveDraft();
            }}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            testID="leave-save"
          >
            <Text style={styles.primaryBtnText}>Save to Library</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              discardOnClose.current = true;
              setLeaveOpen(false);
            }}
            style={({ pressed }) => [styles.keepBtn, pressed && { borderColor: colors.borderStrong }]}
            testID="leave-discard"
          >
            <Text style={[styles.keepBtnText, { color: colors.dangerInk }]}>Discard</Text>
          </Pressable>
        </Window>
      </>
    );
  }

  if (!entry) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Recipe' }} />
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: recipeTitle,
          // The title renames: tap it, the same window as ⋮ › Rename.
          headerTitle: () => <TitleButton title={recipeTitle} onPress={() => setTitleOpen(true)} />,
          gestureEnabled: false,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ShoppingCartButton testID="recipe-shopping-cart" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More actions"
              onPress={() => setMenuOpen(true)}
              hitSlop={6}
              style={styles.menuBtn}
              testID="recipe-menu"
            >
              <Feather name="more-vertical" size={22} color={colors.foreground} />
            </Pressable>
            </View>
          ),
        }}
      />
      <RecipeScreen
        initialView={initialView}
        recipe={entry.recipe}
        onOpenOriginal={() => router.push(`/original/${entry.id}`)}
        sourceSteps={savedSourceSteps}
        request={request}
        photoEntry={entry}
        onAddToList={() => openAddToList(entry.id)}
        done={entry.done}
        servings={entry.servings}
        timer={entry.timer}
        cooked={entry.cooked ?? []}
        rating={entry.rating ?? null}
        notes={entry.notes ?? null}
        mode={entry.mode}
        order={entry.order ?? null}
        onUpdate={write}
        notice={syncError ?? entryNotice}
        onDismissNotice={() => {
          setSyncError(null);
          clearNotice();
        }}
        offlineQueued={queued.includes(entry.id)}
        onActivity={onActivity}
        onCooked={() => ask('rate')}
        onRate={(r) => {
          const before = entry.rating;
          write({ rating: r });
          if (asksToRemove(before, r)) ask('remove');
        }}
      />

      <FinishPrompt
        stage={finish}
        title={entry.recipe.title}
        bookName={bookFor(entry).name}
        rating={entry.rating}
        instant={finishInstant}
        onRate={(r) => {
          write({ rating: r });
          // From the cooking prompt a 👎 always asks: a fresh verdict on a
          // fresh cook, even if it was 👎 before.
          if (r === -1) ask('remove');
          else ask('reset');
        }}
        onSkip={() => ask('reset')}
        onKeep={() => {
          ask('reset');
          toast({ message: keptToast(bookFor(entry).name) });
        }}
        onClearProgress={() => {
          // The checks as they were, for Undo. Undo puts back the checks
          // only: a timer the Clear stopped stays stopped.
          const before = entry.done;
          setFinish(null);
          askScreen('clear');
          toast({
            message: clearedToast,
            action: {
              label: 'Undo',
              onPress: () => {
                write({ done: before });
                askScreen('resume');
              },
            },
            durationMs: 5000,
          });
        }}
        onKeepProgress={() => setFinish(null)}
        onRemove={() => {
          // The entry as it goes out, for Undo: the list may not hold it by
          // the time Undo is tapped (a refresh drops removed rows), and
          // restore() adopts it back from this.
          const removedAt = Date.now();
          const snapshot: Entry = { ...entry, rating: -1, removedAt };
          write({ removedAt });
          setFinishInstant(true);
          setFinish(null);
          if (router.canGoBack()) router.back();
          else router.replace('/library');
          toast({
            message: removedToast(entry.recipe.title),
            action: { label: 'Undo', onPress: () => restore(snapshot) },
            durationMs: 5000,
          });
        }}
      />

      {/* A WINDOW, like every dialog that asks something (Sep 24, on the
          phone): the old sheet slid its dark scrim up the screen. An item
          that opens another dialog opens it from onClosed — after this one
          is gone — because iOS can refuse, or take down, a Modal presented
          while another is still dismissing. */}
      <Window
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onClosed={() => {
          const next = afterMenu.current;
          afterMenu.current = null;
          next?.();
        }}
        maxWidth={360}
        testID="recipe-menu-window"
      >
        <Text style={styles.menuTitle} numberOfLines={2} accessibilityRole="header">
          {recipeTitle}
        </Text>
        <View style={styles.menu} accessibilityRole="menu">
          <MenuItem label="Edit recipe" onPress={() => menuThen(() => askScreen('edit'))} colors={colors} testID="menu-edit" />
          <MenuItem label="Rename" onPress={() => menuThen(() => setTitleOpen(true))} colors={colors} testID="menu-rename" />
          {booksAvailable === true && liveBooks.length > 1 ? (
            <MenuItem label="Move to another book" onPress={() => menuThen(() => setBookPickerOpen(true))} colors={colors} testID="menu-move-book" />
          ) : null}
          <MenuItem label="Reorder steps" onPress={() => menuThen(() => askScreen('reorder'))} colors={colors} testID="menu-reorder" />
          {recipeHasAltUnits(entry.recipe) ? (
            <MenuItem
              label={flipLabel(flipTarget(entry.recipe, unitPref))}
              onPress={() => menuThen(() => flipUnitPref(flipTarget(entry.recipe, unitPref)))}
              colors={colors}
              testID="menu-units"
            />
          ) : null}
          <MenuItem label="Servings" onPress={() => menuThen(() => askScreen('servings'))} colors={colors} testID="menu-servings" />
          {/* A rating is an opinion about a dish, so it is offered once the
              recipe has been cooked — before that it would be about a page. */}
          {entry.cooked?.length ? (
            <MenuItem label="Rating" onPress={() => menuThen(() => askScreen('rating'))} colors={colors} testID="menu-rating" />
          ) : null}
          {/* The way back to the list once something is on it; adding is
              the button beside Clear progress (RecipeScreen). */}
          {shoppingCount > 0 ? (
            <MenuItem
              label={`Shopping list (${shoppingCount})`}
              onPress={() => menuThen(() => router.push('/shopping-list'))}
              colors={colors}
              testID="menu-shopping-list"
            />
          ) : null}
          <MenuItem label="Notes" onPress={() => menuThen(() => askScreen('notes'))} colors={colors} testID="menu-notes" />
          <MenuItem label="Meal types" onPress={() => menuThen(() => setMealSheetOpen(true))} colors={colors} testID="menu-meal-types" />
          <MenuItem label="Photo" onPress={() => menuThen(() => setPhotoSheetOpen(true))} colors={colors} testID="menu-photo" />
          <MenuItem label="Original recipe" onPress={() => menuThen(() => router.push(`/original/${entry.id}`))} colors={colors} testID="menu-original" />
          <MenuItem label="Delete recipe" danger onPress={() => menuThen(() => setConfirmDelete(true))} colors={colors} testID="menu-delete" />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMenuOpen(false)}
          style={({ pressed }) => [styles.menuClose, pressed && styles.menuItemPressed]}
          testID="menu-close"
        >
          <Text style={styles.menuCloseText}>Close</Text>
        </Pressable>
      </Window>

      {/* A recipe edit like any other — the same op the editor's Title field
          applies — written through the sync engine, so a rename made with
          no connection waits in the queue and is sent when it returns. It
          touches only this account's row. */}
      <TitleWindow
        open={titleOpen}
        title={entry.recipe.title ?? ''}
        onSave={(title) => write({ recipe: applyEdit(entry.recipe, { type: 'setRecipeFields', fields: { title } }) })}
        onClose={() => setTitleOpen(false)}
      />

      {/* A move is a field on the entry, through the sync engine like any
          edit: it waits out a dead spot, and two devices moving it at once
          is an ordinary 409 where the later move wins. */}
      <BookPicker
        open={bookPickerOpen}
        title="Move to…"
        current={bookFor(entry).id}
        onPick={(id, name) => {
          setBookPickerOpen(false);
          if (id === bookFor(entry).id) return;
          write({ book: id });
          toast({ message: `Moved to ${name}.` });
        }}
        onClose={() => setBookPickerOpen(false)}
      />

      <PhotoSheet open={photoSheetOpen} entry={entry} onClose={() => setPhotoSheetOpen(false)} />

      <MealTypeSheet
        open={mealSheetOpen}
        mealTypes={entry.recipe.mealTypes}
        // Recipe-level metadata: a direct update, not an applyEdit op. The
        // server sanitises the same list on write.
        onChange={(next) => write({ recipe: { ...entry.recipe, mealTypes: next } })}
        onClose={() => setMealSheetOpen(false)}
      />

      {/* Confirmed rather than immediate, unlike the web: a thumb on a phone
          reaches "Delete" far more easily than a mouse does, and there is no
          undo for it. */}
      <Window open={confirmDelete} onClose={() => setConfirmDelete(false)} instant={deleting} maxWidth={400} testID="recipe-delete-window">
        <Text style={styles.confirmHeading} accessibilityRole="header">
          Delete this recipe?
        </Text>
        <Text style={styles.confirmBody}>
          {recipeTitle} and its progress are removed from your library. There is no undo.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={deleting}
          onPress={async () => {
            setDeleting(true);
            // Optimistic: the row is gone from the list now; a failed
            // delete brings it back with a notice on the library.
            await remove(entry.id);
            setConfirmDelete(false);
            // Opened from a link there may be nothing to go back to.
            if (router.canGoBack()) router.back();
            else router.replace('/library');
          }}
          style={({ pressed }) => [styles.dangerBtn, (pressed || deleting) && { opacity: 0.85 }]}
          testID="recipe-delete-confirm"
        >
          <Text style={styles.dangerBtnText}>{deleting ? 'Deleting…' : 'Delete recipe'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmDelete(false)}
          style={({ pressed }) => [styles.keepBtn, pressed && { borderColor: colors.borderStrong }]}
          testID="recipe-delete-keep"
        >
          <Text style={styles.keepBtnText}>Keep it</Text>
        </Pressable>
      </Window>
    </>
  );
}

const titleProblemFree = (title: string | undefined): boolean => titleProblem(title) === null;

function MenuItem({ label, onPress, danger, colors, testID }: { label: string; onPress: () => void; danger?: boolean; colors: Colors; testID?: string }) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
    >
      <Text style={[styles.menuText, danger && { color: colors.dangerInk }]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    menuBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    menu: { gap: 2, marginBottom: 6 },
    menuItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6, borderRadius: colors.radius },
    menuItemPressed: { backgroundColor: colors.muted },
    menuText: { fontSize: 16, color: colors.foreground },
    menuTitle: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.foreground, marginBottom: 8, paddingHorizontal: 6 },
    menuClose: { marginTop: 6, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: colors.radius },
    menuCloseText: { fontSize: 15, color: colors.mutedForeground },
    confirmHeading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    confirmBody: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    // A fixed dark red in both themes: dark mode's danger ink is a light
    // pink, and white on it would not read.
    dangerBtn: { marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#92351b' },
    dangerBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
    keepBtn: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    keepBtnText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    primaryBtn: { marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
    primaryBtnText: { fontSize: 15, fontWeight: '600', color: colors.primaryForeground },
  });
}
