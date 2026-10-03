/**
 * components/find/MyRecipesPane.tsx — Find › My Recipes: search the
 * person's own box.
 *
 * THE RECIPE BOX'S SEARCH, NOT A SECOND ONE. `searchBox` (lib/recipeBox.ts,
 * tested) over title, book, source and ingredient names, removed recipes
 * never matching, and the box's own result row (BoxSearch `ResultRow`) — so
 * the two searches cannot drift. The only difference is the tap: the box
 * opens a book to its page, because it is for browsing a shelf; this opens
 * the recipe.
 *
 * NOTHING MATCHED: say so, then offer what other people have read — at most
 * two pages from the shared cache (`POST /api/recipes/suggestions`, cache
 * only: no model call, no web search, nothing spent), each clearly NOT in
 * the library, with the usage line only where the server's floors allow
 * one. This is the only place in the phone app that line still appears.
 * A page already in the box (saved under another title) is not offered.
 * Tapping one is an ordinary link extraction — a cache hit — landing on the
 * unsaved preview; nothing is added until Save. Under them, a web search
 * for the same words in Browse.
 *
 * THE WALL. Searching the box, and seeing suggestions, never needs a
 * subscription: both are free to us. Opening a suggestion is an extraction,
 * so when the wall is up the tap shows the wall under the suggestions
 * instead of asking the server for something it would refuse.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, isCancelled, suggestRecipes, type ApiError, type SearchResult } from '@/lib/api';
import { createLatest } from '@/lib/latestRequest';
import { searchBox } from '@/lib/recipeBox';
import { useBooks } from '@/lib/books-context';
import { pageIdentity, searchUrl } from '@/lib/browseAddress';
import { BoxSearchField, ResultRow } from '@/components/recipeBox/BoxSearch';
import { useReductionStage } from '@/components/ExtractionProgress';
import { Paywall } from '@/components/Paywall';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

/** How long typing must pause before suggestions are asked for. */
const SUGGEST_DELAY_MS = 400;
/** The server's own floor (api-server routes/recipes.ts). */
const SUGGEST_MIN_CHARS = 3;

export function MyRecipesPane({
  prefill,
  blocked,
  onOpenBrowse,
  bottomInset,
}: {
  /** A query handed over from the Recipe Box. A new token hands over again. */
  prefill: { query: string; token: string } | null;
  blocked: boolean;
  onOpenBrowse: (url: string) => void;
  bottomInset: number;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = useAuth();
  const { entries, setDraft } = useLibrary();
  const [query, setQuery] = useState('');
  const q = query.trim();

  useEffect(() => {
    if (prefill?.query) setQuery(prefill.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.token]);

  // Shelf order, as the box shows them; the sort is the box's default.
  const { books } = useBooks();
  const hits = useMemo(() => searchBox(entries, query, 'added', books), [entries, query, books]);

  // Suggestions: only when nothing of theirs matched. Only the newest
  // request counts (lib/latestRequest.ts), and a keystroke cancels the one
  // in flight.
  const [suggestions, setSuggestions] = useState<SearchResult[] | null>(null);
  // The suggestion whose tap met the wall; the wall shows under the list.
  const [wallFor, setWallFor] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const latest = useRef(createLatest()).current;
  useEffect(() => () => latest.cancel(), [latest]);
  const owned = useMemo(() => new Set(entries.map((e) => pageIdentity(e.recipe.sourceUrl)).filter(Boolean)), [entries]);
  useEffect(() => {
    latest.cancel();
    setSuggestions(null);
    setWallFor(null);
    if (hits.length || q.length < SUGGEST_MIN_CHARS) {
      setAsking(false);
      return;
    }
    setAsking(true);
    const timer = setTimeout(async () => {
      const attempt = latest.begin();
      try {
        const { results } = await suggestRecipes(q, attempt.signal);
        if (attempt.isCurrent()) setSuggestions(results.filter((r) => !owned.has(pageIdentity(r.url))));
      } catch (e) {
        // A suggestion is a courtesy: failing — offline, or a server without
        // the route — there are none, and nothing is said.
        if (!isCancelled(e) && attempt.isCurrent()) setSuggestions([]);
      } finally {
        attempt.settle();
        if (attempt.isCurrent()) setAsking(false);
      }
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
    // `owned` is read at the time of asking; the query is what asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits.length, latest]);

  // Opening a suggestion: the paste box's own extraction, a cache hit.
  const [opening, setOpening] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const open = async (r: SearchResult) => {
    if (opening) return;
    if (blocked) {
      setWallFor(r.url);
      return;
    }
    setOpening(r.url);
    setCardErrors(({ [r.url]: _gone, ...rest }) => rest);
    try {
      const result = await extractFromUrl(r.url);
      setDraft({ recipe: result.recipe, sourceUrl: r.url, original: result.original, sourceKey: result.sourceKey });
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') {
        await refresh();
        setWallFor(r.url);
      } else setCardErrors((prev) => ({ ...prev, [r.url]: err.message || 'Could not open that recipe.' }));
    } finally {
      setOpening(null);
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      style={styles.pane}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID="find-pane-mine"
    >
      <Text style={styles.heading} accessibilityRole="header">
        Search your saved recipes
      </Text>
      <BoxSearchField value={query} onChange={setQuery} inset={false} />

      {!q ? (
        <Text style={styles.hint}>Titles, books and ingredients — “parmesan” finds everything with parmesan in it.</Text>
      ) : hits.length ? (
        <View testID="mine-results">
          <Text style={styles.count} testID="mine-results-count">
            {hits.length} in your recipe box
          </Text>
          {hits.map((hit) => (
            <ResultRow key={hit.entry.id} hit={hit} hint="Opens the recipe" onPick={(h) => router.push(`/recipe/${h.entry.id}`)} />
          ))}
        </View>
      ) : (
        <View style={styles.nothing} testID="mine-no-results">
          <Text style={styles.nothingText}>Nothing in your recipe box matches “{q}”.</Text>

          {asking ? (
            <View style={styles.asking}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          ) : suggestions && suggestions.length ? (
            <View style={styles.suggestions} testID="mine-suggestions">
              <Text style={styles.notYours} testID="mine-suggestions-label">
                <Text style={styles.notYoursStrong}>Not in your library.</Text> Suggestions from recipes other people have saved.
              </Text>
              {suggestions.map((r) => (
                <Suggestion key={r.url} result={r} loading={opening === r.url} error={cardErrors[r.url]} onPick={() => open(r)} />
              ))}
              {wallFor ? (
                <Paywall
                  context="extract"
                  hasRecipes={entries.length > 0}
                  onOpenRecipes={() => router.navigate('/library')}
                />
              ) : null}
            </View>
          ) : null}

          {q.length >= SUGGEST_MIN_CHARS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Searches the web in the Browse tab"
              onPress={() => onOpenBrowse(searchUrl(q))}
              style={({ pressed }) => [styles.webRow, pressed && styles.webRowPressed]}
              testID="mine-search-web"
            >
              <Text style={styles.webRowText} numberOfLines={2}>
                Search the web for “{q}” in Browse
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

/** One suggestion: dashed, like every "not yours yet" card, with its site
 *  and — only when the server sent one — how people found it. Its own
 *  component for the per-card wait line. */
function Suggestion({ result: r, loading, error, onPick }: { result: SearchResult; loading: boolean; error?: string; onPick: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // A cached page opens with no extraction to speak of; the staged wait
  // would describe work nobody is doing.
  const stage = useReductionStage(loading && !r.cached);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.title}, ${r.site}${r.proof ? `, ${r.proof}` : ''}. Not in your library.`}
      accessibilityHint="Opens a preview. Nothing is saved until you save it."
      onPress={onPick}
      disabled={loading}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, loading && styles.cardLoading, error && styles.cardError]}
      testID="mine-suggestion"
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {r.title}
      </Text>
      <Text style={styles.cardSite} numberOfLines={1}>
        {r.site}
      </Text>
      {r.proof ? (
        <Text style={styles.proof} numberOfLines={1} testID="mine-suggestion-proof">
          {r.proof}
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
          {error}
        </Text>
      ) : null}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The page itself: white is for what you touch (Sep 29).
    pane: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingTop: 18, gap: 12 },
    heading: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 27, color: colors.foreground },
    hint: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
    count: { fontSize: 12, color: colors.mutedForeground, marginBottom: 8, marginLeft: 2 },
    nothing: { gap: 12 },
    nothingText: { fontSize: 15, lineHeight: 21, color: colors.mutedForeground },
    asking: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 4 },
    suggestions: { gap: 8 },
    notYours: { fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground },
    notYoursStrong: { fontFamily: fonts.heading, color: colors.foreground },
    // A dashed edge, as the old web-result card: "not yours yet" at a glance.
    card: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: 12,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 3,
      minHeight: 56,
    },
    cardPressed: { borderStyle: 'solid' },
    cardLoading: { borderStyle: 'solid', borderColor: colors.coolLine },
    cardError: { borderStyle: 'solid', borderColor: colors.dangerLine },
    cardTitle: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground },
    cardSite: { fontSize: 12.5, color: colors.mutedForeground },
    proof: { fontSize: 12.5, lineHeight: 17, color: colors.coolInk, fontFamily: fonts.headingMedium },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, minHeight: 22 },
    statusText: { fontSize: 13, color: colors.mutedForeground },
    cardErrorText: { fontSize: 13, lineHeight: 18, color: colors.dangerInk, marginTop: 4 },
    webRow: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
    },
    webRowPressed: { borderColor: colors.borderStrong },
    webRowText: { fontSize: 14.5, color: colors.coolInk, fontFamily: fonts.headingMedium },
  });
}
