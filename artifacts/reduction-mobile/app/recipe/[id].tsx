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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Feather } from '@expo/vector-icons';
import { useLibrary, type EntryPatch } from '@/lib/library-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { MealTypeSheet } from '@/components/recipe/MealTypeSheet';
import { Window } from '@/components/Window';
import { useAuth } from '@/lib/auth-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { PhotoSheet } from '@/components/recipe/PhotoSheet';
import { FinishPrompt, type FinishStage } from '@/components/recipeBox/FinishPrompt';
import { useToast } from '@/components/Toast';
import { asksToRemove, bookById, bookOf, keptToast, removedToast } from '@/lib/recipeBox';
import type { Entry } from '@/lib/api';

export default function RecipeDetailScreen() {
  // `view` is the Recipe Box preview's choice of tab for this visit.
  const { id, view: viewParam } = useLocalSearchParams<{ id: string; view?: string }>();
  const initialView = viewParam === 'cook' || viewParam === 'overview' ? viewParam : undefined;
  const colors = useColors();
  const styles = makeStyles(colors);
  const { draft, setDraft, getEntry, update, remove, restore, saveRecipe, notice, clearNotice, queued } = useLibrary();
  const toast = useToast();
  // The Recipe Box's finish prompt: 'rate' when a cook is stamped, 'remove'
  // after a 👎. Remove closes it instantly, because it navigates.
  const [finish, setFinish] = useState<FinishStage | null>(null);
  const [finishInstant, setFinishInstant] = useState(false);
  const ask = (stage: FinishStage) => {
    setFinishInstant(false);
    setFinish(stage);
  };
  const { refresh: refreshAccount } = useAuth();
  const [saving, setSaving] = useState(false);
  const [draftServings, setDraftServings] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Edit recipe" in the menu opens edit mode in RecipeScreen, which owns it.
  const [editRequest, setEditRequest] = useState(0);
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
  const saveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const saved = await saveRecipe(draft.recipe);
      // The SAVE is what spends the free allowance (the server counts
      // a created row, not an extraction), so the entitlement the
      // Find tab and Settings read has to be re-read here. Without
      // this, Settings said "Free recipe available" after the first
      // recipe was already saved and counted.
      await refreshAccount();
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
          gestureEnabled: false,
          headerRight: () => (
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
          ),
        }}
      />
      <RecipeScreen
        initialView={initialView}
        recipe={entry.recipe}
        editRequest={editRequest}
        photoEntry={entry}
        done={entry.done}
        servings={entry.servings}
        timer={entry.timer}
        cooked={entry.cooked ?? []}
        rating={entry.rating ?? null}
        mode={entry.mode}
        order={entry.order ?? null}
        onUpdate={write}
        onEditMealTypes={() => setMealSheetOpen(true)}
        notice={syncError ?? entryNotice}
        onDismissNotice={() => {
          setSyncError(null);
          clearNotice();
        }}
        offlineQueued={queued.includes(entry.id)}
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
        bookName={bookById(bookOf(entry)).name}
        rating={entry.rating}
        instant={finishInstant}
        onRate={(r) => {
          write({ rating: r });
          // From the cooking prompt a 👎 always asks: a fresh verdict on a
          // fresh cook, even if it was 👎 before.
          if (r === -1) ask('remove');
          else setFinish(null);
        }}
        onSkip={() => setFinish(null)}
        onKeep={() => {
          setFinish(null);
          toast({ message: keptToast(bookById(bookOf(entry)).name) });
        }}
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
          <MenuItem label="Edit recipe" onPress={() => menuThen(() => setEditRequest((n) => n + 1))} colors={colors} testID="menu-edit" />
          <MenuItem label="Meal types" onPress={() => menuThen(() => setMealSheetOpen(true))} colors={colors} testID="menu-meal-types" />
          <MenuItem label="Photo" onPress={() => menuThen(() => setPhotoSheetOpen(true))} colors={colors} testID="menu-photo" />
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
