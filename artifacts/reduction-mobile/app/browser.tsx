/**
 * app/browser.tsx — the recipe browser: a page opened inside the app, and
 * one button that extracts it.
 *
 * WHY. Some sites refuse every server — allrecipes.com answers our fetch
 * with a 402 and refuses Anthropic's outright — but not a person. So the
 * page loads here, in the phone's own browser engine on the phone's own
 * connection; the person checks it is the recipe; and "Extract this page"
 * hands over what the browser rendered (lib/pageCapture.ts), which the
 * server reads exactly as it reads a page it fetched itself: structured
 * data when the card has it, one model call, the card's own wording.
 * Paprika reads such sites the same way (its bookmarklet: a real browser,
 * the person's own visit).
 *
 * HOW IT IS REACHED. Today: the rescue path — a link that ended in "This
 * site blocked us" offers "Open in browser" (Find tab). The Find tab's own
 * Browse entry is Phase 3 (ROADMAP) and will open this same screen.
 *
 * PRIVATE by default: `incognito`, so the rescue browser keeps no cookies
 * or site data between visits (public/privacy.html says so). Nothing about
 * the browsing reaches us; the page is sent only when Extract is tapped.
 */

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageView } from '@/components/browser/PageView';
import type { PageState, PageViewHandle } from '@/components/browser/types';
import { ExtractionProgress } from '@/components/ExtractionProgress';
import { extractFromPage, type ApiError } from '@/lib/api';
import { hostLabel, isWebUrl } from '@/lib/pageCapture';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function BrowserScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { url } = useLocalSearchParams<{ url?: string }>();
  const start = typeof url === 'string' && isWebUrl(url) ? url : null;
  const { refresh } = useAuth();
  const { setDraft } = useLibrary();

  const page = useRef<PageViewHandle>(null);
  const [state, setState] = useState<PageState>({
    url: start ?? '',
    title: '',
    loading: true,
    progress: 0,
    canGoBack: false,
    failed: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extract = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const got = await page.current?.capture();
      if (!got) return;
      if (!got.ok) {
        setError(got.error);
        return;
      }
      const result = await extractFromPage(got.url, got.html);
      setDraft({
        recipe: result.recipe,
        sourceUrl: result.recipe.sourceUrl ?? got.url,
        original: result.original,
        sourceKey: result.sourceKey,
      });
      await refresh();
      // Replace, not push: back from the preview returns to where the
      // person started, not to a page they have finished with.
      router.replace('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') {
        // The Find tab shows the wall; this screen has no business with it.
        await refresh();
        router.back();
        return;
      }
      if (err.status === 413) setError('This page is too large to read. Try the recipe’s print view, or paste the recipe text instead.');
      else setError(err.message || 'Could not extract this page.');
    } finally {
      setBusy(false);
    }
  };

  const host = hostLabel(state.url) || hostLabel(start ?? '');

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: host || 'Browser' }} />
      {/* A thin bar that fills as the page loads, and is gone once it has. */}
      <View style={styles.progressTrack}>
        {state.loading && state.progress < 1 ? (
          <View style={[styles.progressFill, { width: `${Math.max(5, state.progress * 100)}%` }]} />
        ) : null}
      </View>

      <View style={styles.page}>
        {start ? (
          <PageView ref={page} url={start} incognito onState={setState} />
        ) : (
          <Text style={styles.message}>That is not a web page this browser can open.</Text>
        )}
      </View>

      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        {state.failed ? (
          <Text style={styles.error} accessibilityRole="alert" testID="browser-failed">
            {state.failed}
          </Text>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert" testID="browser-error">
            {error}
          </Text>
        ) : (
          <Text style={styles.ask}>Is this the recipe? Scroll to check, then extract it.</Text>
        )}
        <View style={styles.row}>
          {state.canGoBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back a page"
              onPress={() => page.current?.goBack()}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              testID="browser-back"
            >
              <Text style={styles.secondaryText}>‹ Page</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={extract}
            disabled={busy || !start}
            style={({ pressed }) => [styles.primary, (busy || !start) && styles.disabled, pressed && styles.pressed]}
            testID="browser-extract"
          >
            <Text style={styles.primaryText}>{busy ? 'Reading this page…' : 'Extract this page'}</Text>
          </Pressable>
        </View>
        <ExtractionProgress active={busy} testID="browser-progress" />
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    progressTrack: { height: 2, backgroundColor: 'transparent' },
    progressFill: { height: 2, backgroundColor: colors.warmInk },
    page: { flex: 1, backgroundColor: colors.card },
    message: { padding: 20, fontSize: 15, color: colors.mutedForeground },
    bar: {
      gap: 10,
      paddingTop: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    ask: { fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
    row: { flexDirection: 'row', gap: 10 },
    primary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
    },
    primaryText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    secondary: {
      minHeight: 48,
      minWidth: 72,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
    },
    secondaryText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
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
