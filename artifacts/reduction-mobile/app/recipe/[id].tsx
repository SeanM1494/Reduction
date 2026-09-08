/**
 * app/recipe/[id].tsx — one recipe, saved or freshly extracted.
 *
 * id === "draft" shows the just-extracted, not-yet-saved recipe held in
 * LibraryContext's transient `draft` slot (see lib/library-context.tsx) and
 * offers a Save button. Any other id looks up a saved entry and syncs edits
 * straight through `useLibrary().update`.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLibrary } from '@/lib/library-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { useColors } from '@/hooks/useColors';
import type { StepTimer } from '@/lib/api';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const colors = useColors();
  const { draft, setDraft, getEntry, update, saveRecipe } = useLibrary();
  const [saving, setSaving] = useState(false);

  const isDraft = id === 'draft';
  const entry = isDraft ? null : getEntry(id);
  const recipeTitle = isDraft ? draft?.recipe.title : entry?.recipe.title;

  useEffect(() => {
    navigation.setOptions({ title: recipeTitle || 'Recipe' });
  }, [navigation, recipeTitle]);

  if (isDraft) {
    if (!draft) {
      return (
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.mutedForeground }}>This recipe is no longer available.</Text>
        </View>
      );
    }
    return (
      <RecipeScreen
        recipe={draft.recipe}
        done={[]}
        servings={draft.recipe.servings}
        timer={null}
        onToggleDone={() => {}}
        onSetTimer={() => {}}
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
    );
  }

  if (!entry) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  return (
    <RecipeScreen
      recipe={entry.recipe}
      done={entry.done}
      servings={entry.servings}
      timer={entry.timer}
      onToggleDone={(next) => update(entry.id, { done: next })}
      onSetTimer={(timer: StepTimer | null) => update(entry.id, { timer })}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
