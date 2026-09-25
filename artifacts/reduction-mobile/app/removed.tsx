/**
 * app/removed.tsx — Settings › Removed recipes: what a 👎 took out of the
 * recipe box, waiting to come back.
 *
 * Removed is not deleted (ROADMAP "The Recipe Box: books"): each row can be
 * RESTORED — back into its book, keeping its 👎 and so at the back — or
 * DELETED FOREVER, behind a confirmation, through the same delete the
 * recipe's own ⋮ menu uses. Restore is library-context's `restore()`, the
 * write the Undo snackbar makes, so it syncs, merges and survives a device
 * that has never seen the row.
 *
 * The list is the server's (`GET /api/library/removed`, newest first): the
 * library list leaves removed rows out, so nothing on the phone holds them.
 * It is read each time the screen comes into focus.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '@/lib/library-context';
import { loadRemoved, type Entry } from '@/lib/api';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { Window } from '@/components/Window';
import { useToast } from '@/components/Toast';
import { RATING_EMOJI, bookById, bookOf, removedOn, restoredToast } from '@/lib/recipeBox';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function RemovedRecipesScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { restore, remove, notice, clearNotice } = useLibrary();
  const toast = useToast();
  const [list, setList] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const deleted = useRef(new Set<string>());

  const load = useCallback(() => {
    setError(null);
    loadRemoved()
      .then(({ entries }) => setList(entries))
      .catch((e) => setError((e as Error).message || 'Could not load removed recipes.'));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A delete that the server refused comes back as the library's notice
  // for that id: say so here, and re-read — the row is still removed, not
  // gone, and belongs back in this list.
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  useEffect(() => {
    if (notice?.kind !== 'failure' || !deleted.current.has(notice.id)) return;
    deleted.current.delete(notice.id);
    setDeleteFailed(notice.message);
    clearNotice();
    load();
  }, [notice, clearNotice, load]);

  const onRestore = (e: Entry) => {
    restore(e);
    setList((prev) => (prev ?? []).filter((x) => x.id !== e.id));
    toast({ message: restoredToast(e.recipe.title, bookById(bookOf(e)).name, e.rating) });
  };
  const onDelete = (e: Entry) => {
    setConfirm(null);
    deleted.current.add(e.id);
    void remove(e.id);
    setList((prev) => (prev ?? []).filter((x) => x.id !== e.id));
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Removed recipes' }} />
      {error || deleteFailed ? (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorText}>{deleteFailed ?? error}</Text>
          {deleteFailed ? (
            <Pressable accessibilityRole="button" onPress={() => setDeleteFailed(null)} style={styles.errorBtn}>
              <Text style={styles.errorBtnText}>Dismiss</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={load} style={styles.errorBtn}>
              <Text style={styles.errorBtnText}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      {list === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.foreground} />
        </View>
      ) : (
        <FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          data={list ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          ListHeaderComponent={
            list && list.length ? (
              <Text style={styles.intro}>Recipes you took out of your box. Restore puts one back in its book; a 👎 goes to the back.</Text>
            ) : null
          }
          ListEmptyComponent={
            list ? (
              <View style={styles.empty} testID="removed-empty">
                <Text style={styles.emptyText}>Nothing removed. A recipe you take out of your box after a 👎 waits here.</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <RemovedRow entry={item} onRestore={onRestore} onDelete={setConfirm} styles={styles} />}
          testID="removed-list"
        />
      )}

      <Window open={confirm !== null} onClose={() => setConfirm(null)} maxWidth={400} testID="removed-confirm">
        {confirm ? (
          <View>
            <Text style={styles.confirmHeading} accessibilityRole="header">
              Delete it for good?
            </Text>
            <Text style={styles.confirmBody}>
              {confirm.recipe.title} and your progress, ratings and photo for it are deleted. This can't be undone.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => onDelete(confirm)}
              style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.85 }]}
              testID="removed-confirm-delete"
            >
              <Text style={styles.dangerBtnText}>Delete forever</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirm(null)}
              style={({ pressed }) => [styles.cancelBtn, pressed && { borderColor: colors.borderStrong }]}
              testID="removed-confirm-cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
      </Window>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** One removed recipe. A list recycles its rows, so nothing here remembers
 *  the recipe it showed (CLAUDE.md, "A LIST RECYCLES ITS CELLS"). */
function RemovedRow({ entry, onRestore, onDelete, styles }: { entry: Entry; onRestore: (e: Entry) => void; onDelete: (e: Entry) => void; styles: Styles }) {
  const book = bookById(bookOf(entry));
  const photo = useRecipePhoto(entry);
  const primary = sanitizeMealTypes(entry.recipe.mealTypes)[0] ?? null;
  const rating = entry.rating === 1 || entry.rating === 0 || entry.rating === -1 ? RATING_EMOJI[String(entry.rating)] : null;
  return (
    <View style={styles.row} testID={`removed-${entry.id}`}>
      <View style={styles.rowTop}>
        <View style={styles.thumb}>
          {photo ? (
            <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
          ) : (
            <MealTypeArt type={primary} size={22} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {entry.recipe.title}
            {rating ? ` ${rating}` : ''}
          </Text>
          <View style={styles.rowMeta}>
            <View style={[styles.chip, { backgroundColor: book.color }]}>
              <Text style={styles.chipText}>{book.name}</Text>
            </View>
            <Text style={styles.metaText}>{removedOn(entry.removedAt)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.rowButtons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Restore ${entry.recipe.title}`}
          onPress={() => onRestore(entry)}
          style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.85 }]}
          testID={`removed-restore-${entry.id}`}
        >
          <Text style={styles.restoreText}>Restore</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${entry.recipe.title} forever`}
          onPress={() => onDelete(entry)}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
          testID={`removed-delete-${entry.id}`}
        >
          <Text style={styles.deleteText}>Delete forever</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: 16, gap: 10 },
    intro: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground, marginBottom: 4 },
    empty: { paddingTop: 40, paddingHorizontal: 16, alignItems: 'center' },
    emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.mutedForeground },
    row: {
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      gap: 10,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { width: 48, height: 48, borderRadius: 9, overflow: 'hidden' },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
    chip: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
    chipText: { color: '#fff', fontSize: 10, letterSpacing: 0.6, fontWeight: '600', textTransform: 'uppercase' },
    metaText: { flexShrink: 1, fontSize: 12, color: colors.mutedForeground },
    rowButtons: { flexDirection: 'row', gap: 8 },
    restoreBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    restoreText: { fontSize: 14, fontWeight: '600', color: colors.primaryForeground },
    deleteBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    deleteText: { fontSize: 14, fontWeight: '600', color: colors.dangerInk },
    error: { margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, backgroundColor: colors.dangerBg, gap: 8 },
    errorText: { fontSize: 14, color: colors.dangerInk },
    errorBtn: { minHeight: 44, justifyContent: 'center' },
    errorBtnText: { fontSize: 14, fontWeight: '600', color: colors.foreground },
    confirmHeading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    confirmBody: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    // A fixed dark red in both themes: dark mode's danger ink is a light
    // pink, and white on it would not read.
    dangerBtn: { marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#92351b' },
    dangerBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
    cancelBtn: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    cancelBtnText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  });
}
