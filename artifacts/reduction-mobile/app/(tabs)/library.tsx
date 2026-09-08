/**
 * app/(tabs)/library.tsx — every recipe this account has saved.
 */

import React, { useCallback, useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useLibrary } from '@/lib/library-context';
import { countAll } from '@/shared/amounts';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export default function LibraryScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entries, loading, refresh } = useLibrary();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (!loading && entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No recipes yet</Text>
        <Text style={styles.emptyText}>Recipes you extract from the Find tab will show up here.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(e) => e.id}
      scrollEnabled={entries.length > 0}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.foreground} />}
      renderItem={({ item }) => <RecipeCard entry={item} colors={colors} />}
    />
  );
}

function RecipeCard({ entry, colors }: { entry: Entry; colors: Colors }) {
  const styles = makeStyles(colors);
  const total = countAll(entry.recipe);
  const doneCount = entry.done.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/recipe/${entry.id}`)}>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {entry.recipe.title}
      </Text>
      {entry.recipe.yieldText ? <Text style={styles.cardMeta}>{entry.recipe.yieldText}</Text> : null}
      {pct > 0 ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8, backgroundColor: colors.background },
    emptyTitle: { fontFamily: fonts.headingMedium, fontSize: 18, color: colors.foreground },
    emptyText: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    cardTitle: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.foreground },
    cardMeta: { fontSize: 13, color: colors.mutedForeground },
    progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.coolLine },
  });
}
