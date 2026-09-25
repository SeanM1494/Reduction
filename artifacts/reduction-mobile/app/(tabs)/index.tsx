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

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, extractFromText, extractFromFile, ApiError } from '@/lib/api';
import { PhotoPicker } from '@/components/PhotoPicker';
import { ExtractionProgress } from '@/components/ExtractionProgress';
import { SearchBar } from '@/components/SearchBar';
import type { PreparedPhoto } from '@/lib/photo';
import type { Recipe } from '@/shared/layout';
import { Paywall } from '@/components/Paywall';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export default function FindScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entitlement, refresh } = useAuth();
  const { setDraft, entries } = useLibrary();
  const insets = useSafeAreaInsets();
  // "Search the web for it" from the Recipe Box arrives as ?q=. Taken once
  // and cleared, so coming back to this tab later does not search again.
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [prefill, setPrefill] = useState<{ query: string; token: string } | null>(null);
  useEffect(() => {
    if (!q) return;
    setPrefill({ query: q, token: `${Date.now()}` });
    router.setParams({ q: undefined });
  }, [q]);

  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [busy, setBusy] = useState<'text' | 'photo' | 'search' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The same predicate as the web's isWalled: the wall bites only when the
  // allowance is exhausted AND enforcement is on. `allowed` alone is the
  // truth of the rule; `enforced` is whether it may act (CLAUDE.md, "The
  // wall is off by default"). Gating on `allowed` alone walled mobile users
  // during the shadow period while the web let them through.
  const blocked = entitlement !== null && !entitlement.allowed && entitlement.enforced;

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

  /** A web search result, picked: the same extraction as a pasted link,
   *  but rejecting on failure so the card can own its own error while the
   *  rest of the panel stays usable (the web's `runSilently`). */
  const pickWebResult = async (url: string) => {
    if (busy) return;
    // Its own marker: the paste box's button still disables, but its
    // progress line stays off — the card carries this wait's words.
    setBusy('search');
    try {
      const result = await extractFromUrl(url);
      setDraft({ recipe: result.recipe, sourceUrl: url });
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') await refresh();
      throw err;
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
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
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
        // Their most recent recipe is the door out of the wall, as on the
        // web (the library loads newest first).
        <Paywall
          context="extract"
          recipeTitle={entries[0]?.recipe.title ?? null}
          onOpenRecipe={entries[0] ? () => router.push(`/recipe/${entries[0].id}`) : undefined}
        />
      ) : (
        <>
          {/* The web's header search, in the tab: the library first, the
              web underneath. Above the paste box because a saved recipe
              is the cheaper answer to "I want to cook X". */}
          <SearchBar onPickWebResult={pickWebResult} disabled={!!busy} prefill={prefill} />
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
          {/* The wait, in words, under the button that started it. Only for
              this box's own extraction: the photo picker carries its own
              line under its own button, so the message sits where the
              person is looking. */}
          <ExtractionProgress active={busy === 'text'} testID="find-progress" />

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
    // The paste box: a strong edge (the hairline `border` is within a shade
    // of the page) and the card shadow, so it reads as the thing to tap.
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: colors.radius,
      padding: 14,
      // 16px is the input floor: iOS Safari zooms toward any focused input
      // below it (the web export), and it is the house rule regardless.
      fontSize: 16,
      color: colors.foreground,
      minHeight: 110,
      textAlignVertical: 'top',
      ...cardShadow,
    },
    // .rd-go: ink on 12px radius, 44px minimum.
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radiusButton,
      minHeight: 48,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    // .rd-alert: the danger tokens, not the scaffold's solid red block.
    error: {
      color: colors.dangerInk,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      padding: 12,
      borderRadius: 9,
      fontSize: 13.5,
      lineHeight: 19,
    },
  });
}
