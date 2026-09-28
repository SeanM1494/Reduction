/**
 * components/find/BrowsePane.tsx — Find › Browse: the in-app browser, as a
 * tab. What app/browser.tsx was (the rescue path for a site that refuses
 * every server), moved here so a blocked link from Add New and the Browse
 * tab are one browser.
 *
 * WHY. Some sites refuse every server — allrecipes.com answers our fetch
 * with a 402 and refuses Anthropic's outright — but not a person. So the
 * page loads here, in the phone's own browser engine on the phone's own
 * connection; the person checks it is the recipe; and "Extract this page"
 * hands over what the browser rendered (lib/pageCapture.ts), which the
 * server reads exactly as it reads a page it fetched itself.
 *
 * PRIVATE: `incognito`, so nothing is kept once the app closes
 * (public/privacy.html says so). Nothing about the browsing reaches us; the
 * page is sent only when Extract is tapped.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { PageView } from '@/components/browser/PageView';
import type { PageState, PageViewHandle } from '@/components/browser/types';
import { ExtractionProgress } from '@/components/ExtractionProgress';
import { extractFromPage, type ApiError } from '@/lib/api';
import { isWebUrl } from '@/lib/pageCapture';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const BLANK: PageState = { url: '', title: '', loading: false, progress: 0, canGoBack: false, failed: null };

export function BrowsePane({
  request,
  bottomInset,
}: {
  /** A page to open, from Add New's link or a blocked link's rescue. A new
   *  token opens it again, even the same address. */
  request: { url: string; token: string } | null;
  bottomInset: number;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = useAuth();
  const { setDraft } = useLibrary();

  const page = useRef<PageViewHandle>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [state, setState] = useState<PageState>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (next: string) => {
    setError(null);
    setUrl(next);
    setAddress(next);
    setState({ ...BLANK, url: next, loading: true });
  };

  useEffect(() => {
    if (request && isWebUrl(request.url)) open(request.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);

  useEffect(() => {
    if (state.url) setAddress(state.url);
  }, [state.url]);

  const go = () => {
    const raw = address.trim();
    if (!raw) return;
    const next = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (isWebUrl(next)) open(next);
  };

  const extract = async () => {
    if (busy || !url) return;
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
      setDraft({ recipe: result.recipe, sourceUrl: result.recipe.sourceUrl ?? got.url, original: result.original, sourceKey: result.sourceKey });
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') {
        await refresh();
        setError('Adding a new recipe needs a subscription.');
        return;
      }
      if (err.status === 413) setError('This page is too large to read. Try the recipe’s print view, or paste the recipe text instead.');
      else setError(err.message || 'Could not extract this page.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.pane, { paddingBottom: bottomInset }]} testID="find-pane-browse">
      <View style={styles.addressRow}>
        <TextInput
          style={styles.address}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={go}
          placeholder="Type a web address"
          placeholderTextColor={colors.faint}
          keyboardType="url"
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
          accessibilityLabel="Web address"
          testID="browse-address"
        />
      </View>
      <View style={styles.progressTrack}>
        {state.loading && state.progress < 1 ? <View style={[styles.progressFill, { width: `${Math.max(5, state.progress * 100)}%` }]} /> : null}
      </View>

      <View style={styles.page}>
        {url ? (
          <PageView ref={page} url={url} incognito onState={setState} />
        ) : (
          <Text style={styles.message}>Open a recipe, then tap Extract this page.</Text>
        )}
      </View>

      {url ? (
        <View style={styles.bar}>
          {state.failed ? (
            <Text style={styles.error} accessibilityRole="alert" testID="browser-failed">
              {state.failed}
            </Text>
          ) : null}
          {error ? (
            <Text style={styles.error} accessibilityRole="alert" testID="browser-error">
              {error}
            </Text>
          ) : null}
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
              disabled={busy}
              style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
              testID="browser-extract"
            >
              <Text style={styles.primaryText}>{busy ? 'Reading this page…' : 'Extract this page'}</Text>
            </Pressable>
          </View>
          <ExtractionProgress active={busy} testID="browser-progress" />
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    pane: { flex: 1, backgroundColor: colors.card },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
    // 16px: the input floor (CLAUDE.md).
    address: {
      flex: 1,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.foreground,
    },
    progressTrack: { height: 2, backgroundColor: 'transparent' },
    progressFill: { height: 2, backgroundColor: colors.warmInk },
    page: { flex: 1, backgroundColor: colors.card },
    message: { padding: 20, fontSize: 15, color: colors.mutedForeground },
    bar: {
      gap: 8,
      paddingTop: 10,
      paddingBottom: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    row: { flexDirection: 'row', gap: 8 },
    primary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
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
