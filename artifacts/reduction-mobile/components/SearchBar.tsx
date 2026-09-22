/**
 * components/SearchBar.tsx — the Find tab's search, ported from the web.
 *
 * Typing filters the saved library instantly and locally (title, source,
 * ingredient names — `searchLibrary`, no network). A row underneath always
 * offers to search the web for the same query; that hits the server and
 * shows separate, visually distinct cards for pages that have not been
 * saved yet. Tapping a card runs the same extraction the paste box runs,
 * so the result lands as the draft the way every other extraction does —
 * the one place the web differs, where a picked result goes straight into
 * the library (MOBILE_PARITY, "Extraction does not save").
 *
 * The "Instant" badge says what the user gets, not what happened behind
 * it: nobody needs to know somebody else read this page first, and the
 * promise the badge makes is the one that matters — tapping it opens
 * straight away.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLibrary } from '@/lib/library-context';
import { isCancelled, searchRecipes, type SearchResult } from '@/lib/api';
import { createLatest } from '@/lib/latestRequest';
import { searchLibrary } from '@/lib/libraryView';
import { useReductionStage } from '@/components/ExtractionProgress';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

interface Props {
  /** The paste box's own extraction, so a web result and a pasted link
   *  take one path. Rejects on failure so the card can own its error. */
  onPickWebResult: (url: string) => Promise<void>;
  /** Anything else on the tab is busy (a pasted extraction running). */
  disabled?: boolean;
}

export function SearchBar({ onPickWebResult, disabled }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entries } = useLibrary();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [webResults, setWebResults] = useState<SearchResult[] | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  const matches = useMemo(() => searchLibrary(entries, query), [entries, query]);
  const open = query.trim().length > 0;

  // Only the newest search counts (lib/latestRequest.ts, tested). A ref, so
  // it is the same one for the component's whole life.
  const search = useRef(createLatest()).current;

  // A fresh keystroke invalidates whatever the last web search found — and
  // the one still running for the query before it, which would otherwise
  // land afterwards and fill the panel with results for a search the box no
  // longer shows. Cancelling rather than ignoring also stops an upstream
  // call nobody will read; a search is spent on the user's behalf.
  useEffect(() => {
    search.cancel();
    setSearching(false);
    setWebResults(null);
    setSearchError(null);
  }, [query, search]);

  // A search left running when the bar goes away is the same waste.
  useEffect(() => () => search.cancel(), [search]);

  const reset = () => {
    setQuery('');
    setWebResults(null);
    setSearchError(null);
  };

  const runWebSearch = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    // Tapping again supersedes rather than being refused: the old guard
    // (`|| searching`) locked the row for as long as a stale request took,
    // which made the person wait on an answer that was already useless.
    const attempt = search.begin();
    setSearching(true);
    setSearchError(null);
    try {
      const { results } = await searchRecipes(q, attempt.signal);
      if (attempt.isCurrent()) setWebResults(results);
    } catch (e) {
      // A cancel is a decision, not a failure: the newer search owns the
      // panel now and this one has nothing to say.
      if (isCancelled(e) || !attempt.isCurrent()) return;
      setSearchError((e as Error).message);
      setWebResults(null);
    } finally {
      attempt.settle();
      if (attempt.isCurrent()) setSearching(false);
    }
  };

  const pick = async (r: SearchResult) => {
    if (loadingUrl || disabled) return;
    setLoadingUrl(r.url);
    setCardErrors((prev) => {
      if (!(r.url in prev)) return prev;
      const next = { ...prev };
      delete next[r.url];
      return next;
    });
    try {
      await onPickWebResult(r.url);
      reset(); // success navigated away; clear the bar for next time
    } catch (e) {
      setCardErrors((prev) => ({ ...prev, [r.url]: (e as Error).message }));
    } finally {
      setLoadingUrl(null);
    }
  };

  return (
    <View style={styles.wrap} testID="search-bar">
      <TextInput
        style={styles.input}
        placeholder="Search your recipes, or the web"
        placeholderTextColor={colors.faint}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={runWebSearch}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search your recipes, or the web"
        testID="search-input"
      />

      {open ? (
        <View style={styles.panel} testID="search-panel">
          {matches.length ? (
            <View style={styles.section}>
              {matches.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.recipe.title}`}
                  onPress={() => {
                    reset();
                    router.push(`/recipe/${entry.id}`);
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  testID={`search-local-${entry.id}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entry.recipe.title}
                  </Text>
                  {entry.recipe.source ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {entry.recipe.source}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={runWebSearch}
            disabled={query.trim().length < 3}
            style={({ pressed }) => [styles.webRow, pressed && styles.rowPressed, query.trim().length < 3 && styles.webRowDisabled]}
            testID="search-web"
          >
            <Text style={styles.webRowText} numberOfLines={1}>
              {searching ? 'Searching the web…' : `Search the web for “${query.trim()}”`}
            </Text>
          </Pressable>

          {searchError ? (
            <Text style={styles.error} accessibilityRole="alert" testID="search-error">
              {searchError}
            </Text>
          ) : null}

          {webResults ? (
            webResults.length === 0 ? (
              <Text style={styles.empty} testID="search-empty">
                No recipe pages turned up for that search. Try different words.
              </Text>
            ) : (
              <View style={styles.section} testID="search-results">
                {webResults.map((r) => (
                  <WebResultCard key={r.url} result={r} loading={loadingUrl === r.url} error={cardErrors[r.url]} onPick={() => pick(r)} colors={colors} />
                ))}
              </View>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One web result. Its own component so it can hold a hook: the rotating
 *  wait message is per card, because only the card you tapped is doing
 *  anything. A cached result opens with no extraction at all, so the
 *  sequence would be a lie about work nobody is doing. */
function WebResultCard({
  result: r,
  loading,
  error,
  onPick,
  colors,
}: {
  result: SearchResult;
  loading: boolean;
  error?: string;
  onPick: () => void;
  colors: Colors;
}) {
  const styles = makeStyles(colors);
  const stage = useReductionStage(loading && !r.cached);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.title}, ${r.site}${r.cached ? ', opens instantly' : ''}`}
      onPress={onPick}
      disabled={loading}
      style={({ pressed }) => [styles.card, pressed && styles.rowPressed, loading && styles.cardLoading, error && styles.cardError]}
      testID="search-result"
    >
      <View style={styles.cardTitleRow}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {r.title}
        </Text>
        {r.cached ? (
          <View style={styles.instant} testID="search-instant">
            <Text style={styles.instantText}>INSTANT</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {r.site}
      </Text>
      {r.note ? (
        <Text style={styles.note} numberOfLines={2}>
          {r.note}
        </Text>
      ) : null}
      {loading ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={styles.statusText}>{stage ?? 'Opening…'}</Text>
        </View>
      ) : null}
      {error ? (
        <Text style={styles.cardErrorText} accessibilityRole="alert">
          {error} Try another result.
        </Text>
      ) : null}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    // .rd-search-input: the same box as the paste input, one line.
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      minHeight: 48,
      fontSize: 16,
      color: colors.foreground,
      ...cardShadow,
    },
    // .rd-search-panel: a card under the input holding both lists.
    panel: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radiusCard,
      paddingVertical: 4,
      paddingHorizontal: 6,
      gap: 2,
      ...cardShadow,
    },
    section: { gap: 2 },
    row: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: colors.radius, gap: 2 },
    rowPressed: { backgroundColor: colors.muted },
    rowTitle: { fontFamily: fonts.headingMedium, fontSize: 15, color: colors.foreground, flexShrink: 1 },
    rowMeta: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.faint },
    // .rd-search-web-row: the always-present way out to the web.
    webRow: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 2 },
    webRowDisabled: { opacity: 0.5 },
    webRowText: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium },
    error: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk, paddingHorizontal: 10, paddingVertical: 8 },
    empty: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground, paddingHorizontal: 10, paddingVertical: 10 },
    // .rd-search-web-card: distinct from a local row — a dashed edge, its
    // own padding — so "not yours yet" reads at a glance.
    card: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 3,
      minHeight: 48,
    },
    cardLoading: { borderStyle: 'solid', borderColor: colors.coolLine },
    cardError: { borderStyle: 'solid', borderColor: colors.dangerLine },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    instant: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: colors.coolBg, borderWidth: 1, borderColor: colors.coolLine },
    instantText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: colors.coolInk },
    note: { fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, minHeight: 22 },
    statusText: { fontSize: 13, color: colors.mutedForeground },
    cardErrorText: { fontSize: 13, lineHeight: 18, color: colors.dangerInk, marginTop: 4 },
  });
}
