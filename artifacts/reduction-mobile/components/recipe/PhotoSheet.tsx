/**
 * components/recipe/PhotoSheet.tsx — the recipe's picture, from its menu:
 * take one, choose one, or remove it. The picture shown is whatever the
 * library holds (a page photo, a user photo, or the meal-type art), and a
 * new one replaces it the moment the server confirms. The photo is
 * server-owned, so the result goes to `setPhoto` and never through the
 * sync engine.
 *
 * lib/photo.ts does the permission, the pick and the shrink — the same path
 * the Find tab's photo extraction uses — so an upload is already the size
 * the server stores.
 */

import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Sheet, SheetButton, SheetNote, optionRow } from '@/components/Sheet';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { PhotoError, takePhoto, type PhotoSource } from '@/lib/photo';
import { removePhoto, uploadPhoto, type Entry } from '@/lib/api';
import { useLibrary } from '@/lib/library-context';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import { useColors, type Colors } from '@/hooks/useColors';

export function PhotoSheet({ open, entry, onClose }: { open: boolean; entry: Entry; onClose: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { setPhoto } = useLibrary();
  const current = useRecipePhoto(entry);
  const [busy, setBusy] = useState<'camera' | 'library' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const primary = sanitizeMealTypes(entry.recipe.mealTypes)[0] ?? null;

  const pick = async (source: PhotoSource) => {
    if (busy) return;
    setError(null);
    setBusy(source);
    try {
      const photo = await takePhoto(source);
      if (!photo) return;
      const { photo: meta } = await uploadPhoto(entry.id, photo.base64, photo.mediaType);
      setPhoto(entry.id, meta);
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : (e as Error).message || 'Could not save that photo.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setError(null);
    setBusy('remove');
    try {
      await removePhoto(entry.id);
      setPhoto(entry.id, null);
    } catch (e) {
      setError((e as Error).message || 'Could not remove the photo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} title="Photo" onClose={onClose}>
      <View style={styles.preview} testID="photo-sheet-preview">
        {current ? (
          <Image source={current} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <MealTypeArt type={primary} size={44} />
        )}
      </View>
      <SheetNote>
        {entry.photo?.source === 'page'
          ? 'This is the picture from the recipe\u2019s page. Yours replaces it.'
          : entry.photo
            ? 'Your photo. A new one replaces it.'
            : 'No picture yet \u2014 the card shows the meal type instead.'}
      </SheetNote>
      <View style={optionRow}>
        <SheetButton label={busy === 'camera' ? 'One moment\u2026' : 'Take photo'} onPress={() => pick('camera')} disabled={!!busy} testID="photo-take" />
        <SheetButton label={busy === 'library' ? 'One moment\u2026' : 'Choose photo'} onPress={() => pick('library')} disabled={!!busy} testID="photo-choose" />
      </View>
      {entry.photo ? (
        <View style={optionRow}>
          <SheetButton label={busy === 'remove' ? 'Removing\u2026' : 'Remove photo'} danger onPress={remove} disabled={!!busy} testID="photo-remove" />
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID="photo-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    preview: {
      aspectRatio: 4 / 3,
      borderRadius: colors.radius,
      overflow: 'hidden',
      backgroundColor: colors.muted,
      marginBottom: 10,
    },
    error: { marginTop: 8, fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
  });
}
