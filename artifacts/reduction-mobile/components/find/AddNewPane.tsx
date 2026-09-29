/**
 * components/find/AddNewPane.tsx — Find › Add New: paste a link, paste the
 * recipe text itself, or photograph the page. Everything the Find screen
 * did before it had tabs, moved rather than rewritten: one extraction path
 * for all three sources, the staged progress line under the button that
 * started it, the 180s extraction wait (lib/api.ts), the photo's own
 * errors, and the wall in place of the controls once the free recipe is
 * spent.
 *
 * Two things are new. A paste that is not a link, and a photo, take an
 * optional Title and From (NameFields), applied to whatever the extraction
 * returns — so a typed title survives a cache hit. And a line under the box
 * says what to do when a site will not be read, with the Browse tab one tap
 * away, carrying the pasted link with it; the "Open in browser" rescue on a
 * blocked site's error lands in the same tab.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, extractFromText, extractFromFile, ApiError, type ExtractResult } from '@/lib/api';
import { PhotoPicker } from '@/components/PhotoPicker';
import { ExtractionProgress } from '@/components/ExtractionProgress';
import { Paywall } from '@/components/Paywall';
import { EMPTY_NAMES, NameFields, type NameValues } from '@/components/find/NameFields';
import { withUserFields } from '@/shared/title';
import type { PreparedPhoto } from '@/lib/photo';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export function AddNewPane({
  blocked,
  onOpenBrowse,
  bottomInset,
}: {
  /** The wall is up (the Find screen's one predicate). */
  blocked: boolean;
  /** Switch to Browse, opening `url` there when there is one. */
  onOpenBrowse: (url: string | null) => void;
  bottomInset: number;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = useAuth();
  const { setDraft, entries } = useLibrary();

  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [names, setNames] = useState<NameValues>(EMPTY_NAMES);
  const [busy, setBusy] = useState<'text' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A link that ended in "This site blocked us" (code site_blocked): the
  // server cannot read it, but the phone can — the Browse tab opens it.
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const looksLikeUrl = /^https?:\/\//i.test(input.trim());
  const textMode = input.trim().length > 0 && !looksLikeUrl;

  /** One extraction path for all three sources: the typed names applied,
   *  the result made the draft, the allowance re-read, the draft opened. */
  const run = async (kind: 'text' | 'photo', go: () => Promise<ExtractResult>, sourceUrl: string | null, typed: NameValues) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setBlockedUrl(null);
    try {
      const result = await go();
      // After the reply, whatever it was — a fresh read or a cache hit —
      // so the person's title wins, and nothing typed is ever sent to the
      // server, let alone written into the shared cache.
      setDraft({ recipe: withUserFields(result.recipe, typed), sourceUrl, original: result.original, sourceKey: result.sourceKey });
      setInput('');
      setPhoto(null);
      setNames(EMPTY_NAMES);
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
        if (err.code === 'site_blocked' && sourceUrl) setBlockedUrl(sourceUrl);
      }
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    const value = input.trim();
    if (!value) return;
    if (looksLikeUrl) run('text', () => extractFromUrl(value), value, EMPTY_NAMES);
    else run('text', () => extractFromText(value), null, names);
  };

  const submitPhoto = () => {
    if (!photo) return;
    run('photo', () => extractFromFile(photo.base64, photo.mediaType), null, names);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      style={styles.pane}
      // The tab bar is absolutely positioned (see (tabs)/_layout.tsx), so
      // the content pads itself past it — without this the photo section's
      // extract button sat under the bar, unreachable.
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      keyboardShouldPersistTaps="handled"
      testID="find-pane-add"
    >
      <Text style={styles.heading} accessibilityRole="header">
        Add a recipe from a link, photo or text
      </Text>

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
          <TextInput
            style={styles.input}
            placeholder="https://example.com/recipe or paste recipe text"
            placeholderTextColor={colors.faint}
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="A recipe link, or the recipe's text"
          />

          {/* The whole line is the target (44pt); "Browse tab" says where
              it goes. It carries a pasted link across. */}
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens the Browse tab"
            onPress={() => onOpenBrowse(looksLikeUrl ? input.trim() : null)}
            style={({ pressed }) => [styles.disclaimer, pressed && styles.disclaimerPressed]}
            testID="find-browse-hint"
          >
            <Text style={styles.disclaimerText}>
              Some websites don't work with link extraction. If yours doesn't, open it in the{' '}
              <Text style={styles.disclaimerLink}>Browse tab</Text> and extract from there.
            </Text>
          </Pressable>

          {textMode ? <NameFields value={names} onChange={setNames} disabled={!!busy} testID="text-names" /> : null}

          {error ? (
            <Text style={styles.error} accessibilityRole="alert" testID="find-error">
              {error}
            </Text>
          ) : null}
          {error && blockedUrl ? (
            <Pressable
              style={({ pressed }) => [styles.rescue, pressed && { opacity: 0.85 }]}
              onPress={() => onOpenBrowse(blockedUrl)}
              accessibilityRole="button"
              accessibilityHint="Opens the page in the Browse tab, where you can extract it"
              testID="find-open-browser"
            >
              <Text style={styles.rescueText}>Open in browser</Text>
              <Text style={styles.rescueSub}>Load the page in Browse, then extract it</Text>
            </Pressable>
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
          {/* The wait, in words, under the button that started it. The photo
              picker carries its own line under its own button. */}
          <ExtractionProgress active={busy === 'text'} testID="find-progress" />

          <PhotoPicker
            photo={photo}
            onPhoto={setPhoto}
            onExtract={submitPhoto}
            busy={busy === 'photo'}
            // One set of names: under the paste box while it holds text,
            // under the photo otherwise.
            fields={textMode ? null : <NameFields value={names} onChange={setNames} disabled={!!busy} testID="photo-names" />}
          />
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The page itself: white is for what you touch (Sep 29).
    pane: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingTop: 18, gap: 12 },
    heading: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 27, color: colors.foreground },
    // The paste box: a card on the page, with a strong edge, so it reads as
    // the thing to tap.
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
    },
    disclaimer: { minHeight: 44, justifyContent: 'center', borderRadius: 9, paddingHorizontal: 2, marginTop: -4 },
    disclaimerPressed: { backgroundColor: colors.muted },
    disclaimerText: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground },
    disclaimerLink: { color: colors.foreground, fontWeight: '600', textDecorationLine: 'underline' },
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
    // The rescue: a second action, so outlined rather than ink, but a full
    // 48px target — it is the way forward for this link.
    rescue: {
      minHeight: 48,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    rescueText: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.foreground },
    rescueSub: { fontSize: 13, color: colors.mutedForeground },
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
