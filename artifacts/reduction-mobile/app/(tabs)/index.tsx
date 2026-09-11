/**
 * app/(tabs)/index.tsx — Find: paste a URL or text, or photograph a page,
 * and extract a recipe.
 *
 * Three ways in, one route: the photo path posts the same
 * `{ file: { data, mediaType } }` body the web's upload sends (see
 * lib/photo.ts for what the phone does first).
 *
 * Gated by entitlement before the request is even attempted, same reasoning
 * as the web app's Paywall (see components/Paywall.tsx) — a search someone
 * cannot use costs their attention and our extraction budget for nothing.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, extractFromText, extractFromFile, ApiError } from '@/lib/api';
import { PhotoPicker } from '@/components/PhotoPicker';
import type { PreparedPhoto } from '@/lib/photo';
import type { Recipe } from '@/shared/layout';
import { Paywall } from '@/components/Paywall';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function FindScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entitlement, refresh } = useAuth();
  const { setDraft } = useLibrary();
  const insets = useSafeAreaInsets();

  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [busy, setBusy] = useState<'text' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = entitlement !== null && !entitlement.allowed;

  const looksLikeUrl = /^https?:\/\//i.test(input.trim());

  /** One extraction path for all three sources: the result becomes the
   *  draft, the allowance is re-read, and the draft screen opens. */
  const run = async (kind: 'text' | 'photo', go: () => Promise<{ recipe: Recipe }>, sourceUrl: string | null) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const result = await go();
      setDraft({ recipe: result.recipe, sourceUrl });
      setInput('');
      setPhoto(null);
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') {
        await refresh();
      } else if (kind === 'photo' && err.status === 413) {
        // Unreachable after lib/photo.ts's own bound, and the server's
        // reply here is an HTML page rather than JSON, so the message is
        // ours. Kept so a future change to either limit fails in a sentence.
        setError('That photo is too large to send. Try a smaller one.');
      } else if (kind === 'photo' && err.status === 422) {
        // The model could not make a recipe out of the picture: usually a
        // blurry page, a photo of something else, or a page that is only
        // half a recipe. Say what helps rather than echoing the validator.
        setError('Could not read a recipe from that photo. Try a sharper, straight-on shot of the whole page, with the ingredients and steps both in frame.');
      } else {
        setError(err.message || 'Could not extract that recipe.');
      }
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    const value = input.trim();
    if (!value) return;
    run('text', () => (looksLikeUrl ? extractFromUrl(value) : extractFromText(value)), looksLikeUrl ? value : null);
  };

  const submitPhoto = () => {
    if (!photo) return;
    run('photo', () => extractFromFile(photo.base64, photo.mediaType), null);
  };

  return (
    <ScrollView
      style={styles.container}
      // The tab bar is absolutely positioned (see (tabs)/_layout.tsx), so
      // the content pads itself past it — without this the photo section's
      // extract button sat under the bar, unreachable.
      contentContainerStyle={[styles.content, { paddingBottom: 84 + insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Add a recipe</Text>
      <Text style={styles.hint}>Paste a link, paste the recipe text itself, or photograph the page.</Text>

      {blocked ? (
        <Paywall context="extract" />
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="https://example.com/recipe or paste recipe text"
            placeholderTextColor={colors.faint}
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error ? (
            <Text style={styles.error} accessibilityRole="alert" testID="find-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            style={[styles.button, (!input.trim() || !!busy) && styles.buttonDisabled]}
            onPress={submit}
            disabled={!input.trim() || !!busy}
            accessibilityRole="button"
            testID="find-extract"
          >
            {busy === 'text' ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>{looksLikeUrl ? 'Extract from link' : 'Extract recipe'}</Text>
            )}
          </Pressable>

          <PhotoPicker photo={photo} onPhoto={setPhoto} onExtract={submitPhoto} busy={busy === 'photo'} />
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 14 },
    heading: { fontFamily: fonts.headingBold, fontSize: 26, color: colors.foreground },
    hint: { fontSize: 14, color: colors.mutedForeground, marginBottom: 8 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 14,
      // 16px is the input floor: iOS Safari zooms toward any focused input
      // below it (the web export), and it is the house rule regardless.
      fontSize: 16,
      color: colors.foreground,
      minHeight: 110,
      textAlignVertical: 'top',
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    error: {
      color: colors.destructiveForeground,
      backgroundColor: colors.destructive,
      padding: 10,
      borderRadius: colors.radius,
      fontSize: 13,
    },
  });
}
