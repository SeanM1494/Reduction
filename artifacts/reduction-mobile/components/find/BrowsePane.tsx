/**
 * components/find/BrowsePane.tsx — Find › Browse: the in-app browser.
 *
 * WHY. Some sites refuse every server — allrecipes.com answers our fetch
 * with a 402 and refuses Anthropic's outright — but not a person. So the
 * page loads here, in the phone's own browser engine on the phone's own
 * connection; the person checks it is the recipe; and "Extract this page"
 * hands over what the browser rendered (lib/pageCapture.ts), which the
 * server reads exactly as it reads a page it fetched itself, and caches by
 * its CONTENT, never its address (routes/recipes.ts).
 *
 * THE PARTS. An address bar that takes a web address or search words
 * (lib/browseAddress.ts: words go to the one search engine constant),
 * reload in the bar, a way home to the start screen; back, forward, Open
 * in Safari and Extract along the bottom. Before anything is typed, the
 * start screen: a line on how it works and a fixed row of recipe sites —
 * fixed, because a list of recent sites would be history, and this browser
 * keeps none.
 *
 * NOTHING IS SPENT ON A PAGE WITH NO RECIPE. Each page is asked, when it
 * loads and again at the tap, whether it carries a recipe
 * (`looksLikeRecipe`); a "no" says "No recipe found on this page" and turns
 * Extract into "Try anyway". Unknown is never "no".
 *
 * THE WALL COMES FIRST. Browsing is free. Extract and Try anyway check the
 * same predicate as the rest of Find (`allowed && enforced`, from the
 * `entitlementFor` the server's `checkAccess` decides with) BEFORE any
 * request, and show the wall instead; the server's 402 stays as the
 * backstop and re-reads the entitlement.
 *
 * PRIVATE: `incognito` — nothing is kept once the app closes (and the view
 * is rebuilt, fresh, when you go home). Nothing about the browsing reaches
 * us; the page is sent only when Extract is tapped (public/privacy.html).
 *
 * OLDER APPS: the page view is loaded lazily behind a check that the
 * native half exists (components/browser/loadPageView.ts); without it this
 * pane says the app needs updating, and never crashes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { loadPageView } from '@/components/browser/loadPageView';
import type { PageState, PageViewHandle } from '@/components/browser/types';
import { ExtractionProgress } from '@/components/ExtractionProgress';
import { Paywall } from '@/components/Paywall';
import { Window } from '@/components/Window';
import { extractFromPage, type ApiError } from '@/lib/api';
import { hostLabel, isWebUrl } from '@/lib/pageCapture';
import { STARTER_SITES, addressFor, searchWordsOf } from '@/lib/browseAddress';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const BLANK: PageState = { url: '', title: '', loading: false, progress: 0, canGoBack: false, canGoForward: false, failed: null, recipe: null };

export function BrowsePane({
  request,
  blocked,
  bottomInset,
}: {
  /** A page to open, from Add New's link, a blocked link's rescue or My
   *  Recipes' web search. A new token opens it again, even the same page. */
  request: { url: string; token: string } | null;
  /** The wall is up (the Find screen's one predicate). */
  blocked: boolean;
  bottomInset: number;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width } = useWindowDimensions();
  const { entries } = useLibrary();
  const { refresh } = useAuth();
  const { setDraft } = useLibrary();
  const PageView = useMemo(loadPageView, []);

  const page = useRef<PageViewHandle>(null);
  // `url` is what the view was asked to load; `state.url` is where it is.
  const [url, setUrl] = useState<string | null>(null);
  // A fresh view per trip from home, so nothing of the last one lingers.
  const [viewKey, setViewKey] = useState(0);
  const [state, setState] = useState<PageState>(BLANK);
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallOpen, setWallOpen] = useState(false);

  const open = (next: string) => {
    setError(null);
    if (!url) setViewKey((k) => k + 1);
    setUrl(next);
    setState({ ...BLANK, url: next, loading: true });
  };
  const home = () => {
    setUrl(null);
    setState(BLANK);
    setError(null);
    setTyped('');
  };

  useEffect(() => {
    if (request && isWebUrl(request.url)) open(request.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);

  // What the bar shows when nobody is typing in it: the words of a search,
  // otherwise the address.
  const shown = state.url ? (searchWordsOf(state.url) ?? state.url) : '';
  const go = () => {
    const next = addressFor(typed);
    setEditing(false);
    if (next) open(next);
  };

  /** Extract, or Try anyway (`force`): the wall first, then — unless forced
   *  — the page asked again, then the capture and the one request. */
  const extract = async (force: boolean) => {
    if (busy || !url) return;
    if (blocked) {
      setWallOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!force && (await page.current?.detect()) === false) return;
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
        // The phone's entitlement was stale; the server's is not.
        await refresh();
        setWallOpen(true);
        return;
      }
      if (err.status === 413) setError('This page is too large to read. Try the recipe’s print view, or paste the recipe text instead.');
      else setError(err.message || 'Could not extract this page.');
    } finally {
      setBusy(false);
    }
  };

  const noRecipe = !!url && !state.loading && state.recipe === false;
  // "Extract this page" is 125pt of text; beside three 44pt buttons an
  // iPhone SE leaves it about 140.
  const narrow = width < 360;

  return (
    <View style={[styles.pane, { paddingBottom: bottomInset }]} testID="find-pane-browse">
      <View style={styles.addressRow}>
        {url ? (
          <IconButton label="Recipe sites" onPress={home} testID="browse-home" colors={colors}>
            <Feather name="grid" size={19} color={colors.foreground} />
          </IconButton>
        ) : null}
        <TextInput
          style={styles.address}
          value={editing ? typed : shown}
          onChangeText={setTyped}
          onFocus={() => {
            setTyped(shown);
            setEditing(true);
          }}
          onBlur={() => setEditing(false)}
          onSubmitEditing={go}
          placeholder="Search or type a web address"
          placeholderTextColor={colors.faint}
          keyboardType={Platform.OS === 'ios' ? 'web-search' : 'default'}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
          editable={!!PageView}
          accessibilityLabel="Search or type a web address"
          testID="browse-address"
        />
        {url ? (
          <IconButton label="Reload" onPress={() => page.current?.reload()} testID="browse-reload" colors={colors}>
            <Feather name="rotate-cw" size={18} color={colors.foreground} />
          </IconButton>
        ) : null}
      </View>
      <View style={styles.progressTrack}>
        {url && state.loading && state.progress < 1 ? (
          <View style={[styles.progressFill, { width: `${Math.max(5, state.progress * 100)}%` }]} />
        ) : null}
      </View>

      <View style={styles.page}>
        {!PageView ? (
          <View style={styles.startPad} testID="browse-needs-update">
            <Text style={styles.heading}>Browse needs the latest version</Text>
            <Text style={styles.body}>Update Reduction from the App Store to open recipe sites inside the app.</Text>
          </View>
        ) : url ? (
          <PageView key={viewKey} ref={page} url={url} incognito onState={setState} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.startPad}
            keyboardShouldPersistTaps="handled"
            testID="browse-start"
          >
            <Text style={styles.heading} accessibilityRole="header">
              Browse recipe sites
            </Text>
            <Text style={styles.body}>
              Open a recipe, then tap Extract this page. Nothing you browse reaches us until you do, and nothing is remembered
              once the app closes.
            </Text>
            <View style={styles.sites}>
              {STARTER_SITES.map((s) => (
                <Pressable
                  key={s.url}
                  accessibilityRole="link"
                  onPress={() => open(s.url)}
                  style={({ pressed }) => [styles.site, pressed && styles.sitePressed]}
                  testID={`browse-site-${hostLabel(s.url).split('.')[0]}`}
                >
                  <Text style={styles.siteName} numberOfLines={2}>
                    {s.name}
                  </Text>
                  <Text style={styles.siteHost} numberOfLines={1}>
                    {hostLabel(s.url)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      {url && PageView ? (
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
          {noRecipe && !error ? (
            <Text style={styles.noRecipe} accessibilityLiveRegion="polite" testID="browser-no-recipe">
              No recipe found on this page
            </Text>
          ) : null}
          <View style={styles.row}>
            <IconButton label="Back" onPress={() => page.current?.goBack()} disabled={!state.canGoBack} testID="browser-back" colors={colors}>
              <Feather name="chevron-left" size={24} color={colors.foreground} />
            </IconButton>
            <IconButton label="Forward" onPress={() => page.current?.goForward()} disabled={!state.canGoForward} testID="browser-forward" colors={colors}>
              <Feather name="chevron-right" size={24} color={colors.foreground} />
            </IconButton>
            <IconButton
              label="Open in Safari"
              onPress={() => state.url && Linking.openURL(state.url).catch(() => {})}
              disabled={!isWebUrl(state.url) || state.url.startsWith('about:')}
              testID="browser-safari"
              colors={colors}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView name="safari" tintColor={colors.foreground} size={22} />
              ) : (
                <Feather name="external-link" size={19} color={colors.foreground} />
              )}
            </IconButton>
            {noRecipe ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Reads the page anyway. This uses an extraction."
                onPress={() => extract(true)}
                disabled={busy}
                style={({ pressed }) => [styles.secondary, busy && styles.disabled, pressed && styles.pressed]}
                testID="browser-try-anyway"
              >
                <Text style={styles.secondaryText}>{busy ? 'Reading…' : 'Try anyway'}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => extract(false)}
                disabled={busy}
                style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
                testID="browser-extract"
              >
                <Text style={styles.primaryText} numberOfLines={1}>
                  {busy ? 'Reading…' : narrow ? 'Extract' : 'Extract this page'}
                </Text>
              </Pressable>
            )}
          </View>
          <ExtractionProgress active={busy} testID="browser-progress" />
        </View>
      ) : null}

      <Window open={wallOpen} onClose={() => setWallOpen(false)} maxWidth={420} testID="browse-wall">
        <Paywall
          context="extract"
          recipeTitle={entries[0]?.recipe.title ?? null}
          onOpenRecipe={
            entries[0]
              ? () => {
                  setWallOpen(false);
                  router.push(`/recipe/${entries[0].id}`);
                }
              : undefined
          }
        />
        <Pressable accessibilityRole="button" onPress={() => setWallOpen(false)} style={styles.wallClose} testID="browse-wall-close">
          <Text style={styles.wallCloseText}>Keep browsing</Text>
        </Pressable>
      </Window>
    </View>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  testID,
  colors,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.icon, disabled && styles.iconDisabled, pressed && styles.iconPressed]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    pane: { flex: 1, backgroundColor: colors.card },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
    // 16px: the input floor (CLAUDE.md).
    // minWidth 0: a long address must shrink the field, not push reload
    // off the edge (it did, on an SE, before this).
    address: {
      flex: 1,
      minWidth: 0,
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
    startPad: { padding: 16, paddingTop: 12, gap: 12 },
    heading: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 27, color: colors.foreground },
    body: { fontSize: 14.5, lineHeight: 21, color: colors.mutedForeground },
    sites: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    site: {
      flexBasis: '47%',
      flexGrow: 1,
      minHeight: 60,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
    },
    sitePressed: { backgroundColor: colors.muted },
    siteName: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground },
    siteHost: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    bar: {
      gap: 8,
      paddingTop: 8,
      paddingBottom: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    icon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    iconPressed: { backgroundColor: colors.muted },
    iconDisabled: { opacity: 0.3 },
    primary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
    },
    primaryText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    // Try anyway: outlined, because it spends an extraction on a page that
    // shows no sign of a recipe — a choice, not the obvious next step.
    secondary: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      paddingHorizontal: 10,
    },
    secondaryText: { fontSize: 16, fontFamily: fonts.headingMedium, color: colors.foreground },
    noRecipe: { fontSize: 14, lineHeight: 19, color: colors.foreground, fontFamily: fonts.headingMedium, paddingHorizontal: 2 },
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
    wallClose: { marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    wallCloseText: { fontSize: 15, color: colors.mutedForeground },
  });
}
