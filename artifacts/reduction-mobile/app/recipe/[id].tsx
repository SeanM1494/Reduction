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

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useLibrary, type EntryPatch } from '@/lib/library-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { MealTypeSheet } from '@/components/recipe/MealTypeSheet';
import { Sheet, SheetButton, SheetNote } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { draft, setDraft, getEntry, update, remove, saveRecipe, notice, clearNotice } = useLibrary();
  const [saving, setSaving] = useState(false);
  const [draftServings, setDraftServings] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const isDraft = id === 'draft';
  const entry = isDraft ? null : getEntry(id);
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
        <Stack.Screen options={{ title: recipeTitle }} />
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
          onSave={async () => {
            setSaving(true);
            try {
              const saved = await saveRecipe(draft.recipe);
              setDraft(null);
              router.replace(`/recipe/${saved.id}`);
            } catch {
              // saveRecipe surfaces its own error via LibraryContext.error; the
              // draft stays put so the user can retry.
            } finally {
              setSaving(false);
            }
          }}
        />
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
        recipe={entry.recipe}
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
      />

      <Sheet open={menuOpen} title={recipeTitle} closeLabel="Close" onClose={() => setMenuOpen(false)}>
        <View style={styles.menu}>
          <MenuItem
            label="Meal types"
            onPress={() => {
              setMenuOpen(false);
              setMealSheetOpen(true);
            }}
            colors={colors}
          />
          <MenuItem
            label="Clear progress"
            onPress={() => {
              setMenuOpen(false);
              write({ done: [] });
            }}
            colors={colors}
          />
          <MenuItem
            label="Delete recipe"
            danger
            onPress={() => {
              setMenuOpen(false);
              setConfirmDelete(true);
            }}
            colors={colors}
          />
        </View>
      </Sheet>

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
      <Sheet open={confirmDelete} title="Delete this recipe?" closeLabel="Keep it" onClose={() => setConfirmDelete(false)}>
        <SheetNote>
          {recipeTitle} and its progress are removed from your library. There is no undo.
        </SheetNote>
        <View style={styles.confirmRow}>
          <SheetButton
            label={deleting ? 'Deleting…' : 'Delete recipe'}
            danger
            disabled={deleting}
            testID="recipe-delete-confirm"
            onPress={async () => {
              setDeleting(true);
              // Optimistic: the row is gone from the list now; a failed
              // delete brings it back with a notice on the library.
              await remove(entry.id);
              setConfirmDelete(false);
              setDeleting(false);
              router.back();
            }}
          />
        </View>
      </Sheet>
    </>
  );
}

function MenuItem({ label, onPress, danger, colors }: { label: string; onPress: () => void; danger?: boolean; colors: Colors }) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
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
    confirmRow: { marginTop: 16, marginBottom: 6, flexDirection: 'row' },
  });
}
