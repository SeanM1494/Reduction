/**
 * components/find/MyRecipesPane.tsx — Find › My Recipes.
 *
 * For now the Find screen's existing search, moved into its tab unchanged:
 * the library first, the web underneath. The next commit replaces it with
 * the Recipe Box's own search and the cached suggestions (ROADMAP, Phase 3).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, type ApiError } from '@/lib/api';
import { SearchBar } from '@/components/SearchBar';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export function MyRecipesPane({
  prefill,
  bottomInset,
}: {
  prefill: { query: string; token: string } | null;
  bottomInset: number;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = useAuth();
  const { setDraft } = useLibrary();

  const pickWebResult = async (url: string) => {
    try {
      const result = await extractFromUrl(url);
      setDraft({ recipe: result.recipe, sourceUrl: url, original: result.original, sourceKey: result.sourceKey });
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') await refresh();
      throw err;
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      style={styles.pane}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      keyboardShouldPersistTaps="handled"
      testID="find-pane-mine"
    >
      <Text style={styles.heading} accessibilityRole="header">
        Search your saved recipes
      </Text>
      <SearchBar onPickWebResult={pickWebResult} prefill={prefill} />
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    pane: { flex: 1, backgroundColor: colors.card },
    content: { padding: 16, paddingTop: 18, gap: 12 },
    heading: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 27, color: colors.foreground },
  });
}
