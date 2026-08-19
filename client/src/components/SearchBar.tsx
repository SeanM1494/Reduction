/**
 * client/src/components/SearchBar.tsx — persistent header search.
 *
 * Typing filters the saved library instantly and locally (title, source,
 * ingredient names — no network call). A row underneath always offers to
 * search the web for the same query; that hits the server and shows
 * separate, visually-distinct cards for pages that have not been saved yet.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "../lib/storage";
import { searchRecipes, type SearchResult } from "../lib/api";
import { useReductionStage } from "./ExtractionProgress";

interface Props {
  library: Entry[];
  onOpen: (id: string) => void;
  /** Same extraction pipeline the Link tab uses, but rejects on failure
   *  instead of surfacing a shared banner, so a web-result card can own its
   *  own inline error while the rest of the dropdown stays usable. */
  onPickWebResult: (url: string) => Promise<void>;
}

function localMatches(library: Entry[], query: string): Entry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return library.filter((e) => {
    const r = e.recipe;
    if (r.title.toLowerCase().includes(needle)) return true;
    if (r.source && r.source.toLowerCase().includes(needle)) return true;
    return r.sections.some((s) =>
      s.ingredients.some((i) => i.name.toLowerCase().includes(needle))
    );
  });
}

export default function SearchBar({ library, onOpen, onPickWebResult }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [webResults, setWebResults] = useState<SearchResult[] | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => localMatches(library, query), [library, query]);
  const open = query.trim().length > 0;

  // A fresh keystroke invalidates whatever the last web search found.
  useEffect(() => {
    setWebResults(null);
    setSearchError(null);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) reset();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function reset() {
    setQuery("");
    setWebResults(null);
    setSearchError(null);
  }

  async function runWebSearch() {
    const q = query.trim();
    if (q.length < 3 || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setWebResults(await searchRecipes(q));
    } catch (e) {
      setSearchError((e as Error).message);
      setWebResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function pickWebResult(r: SearchResult) {
    if (loadingUrl) return;
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
  }

  return (
    <div className="rd-searchbar" ref={rootRef}>
      <input
        className="rd-search-input"
        type="search"
        placeholder="Search your recipes, or the web"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") runWebSearch();
          if (e.key === "Escape") reset();
        }}
        aria-label="Search your recipes, or the web"
      />

      {open ? (
        <div className="rd-search-panel">
          {matches.length ? (
            <div className="rd-search-section">
              {matches.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="rd-search-row"
                  onClick={() => {
                    onOpen(entry.id);
                    reset();
                  }}
                >
                  <span className="rd-search-row-title">{entry.recipe.title}</span>
                  {entry.recipe.source ? (
                    <span className="rd-search-row-meta">{entry.recipe.source}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="rd-search-web-row"
            onClick={runWebSearch}
            disabled={searching || query.trim().length < 3}
          >
            {searching
              ? "Searching the web\u2026"
              : `Search the web for \u201c${query.trim()}\u201d`}
          </button>

          {searchError ? (
            <p className="rd-search-web-error">{searchError}</p>
          ) : null}

          {webResults ? (
            webResults.length === 0 ? (
              <p className="rd-search-web-empty">
                No recipe pages turned up for that search. Try different words.
              </p>
            ) : (
              <div className="rd-search-section rd-search-web-results">
                {webResults.map((r) => (
                  <WebResultCard
                    key={r.url}
                    result={r}
                    loading={loadingUrl === r.url}
                    error={cardErrors[r.url]}
                    onPick={() => pickWebResult(r)}
                  />
                ))}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One web result.
 *
 * Its own component only so it can hold a hook: the rotating wait message is
 * per card, because only the card you tapped is doing anything.
 */
function WebResultCard({
  result: r,
  loading,
  error: cardError,
  onPick,
}: {
  result: SearchResult;
  loading: boolean;
  error?: string;
  onPick: () => void;
}) {
  // A cached result opens with no extraction at all, so the sequence would be
  // a lie about work nobody is doing — and it would be gone before the second
  // message anyway.
  const stage = useReductionStage(loading && !r.cached);

  return (
    <button
      type="button"
      className={[
        "rd-search-web-card",
        loading ? "is-loading" : "",
        cardError ? "has-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onPick}
      disabled={loading}
    >
      <span className="rd-search-row-title">
        {r.title}
        {/* "Instant" says what the user gets, not what happened behind it —
            nobody needs to know that somebody else read this page first, and
            the promise the badge makes is the one that matters: tapping it
            opens straight away. */}
        {r.cached ? <span className="rd-search-instant">Instant</span> : null}
      </span>
      <span className="rd-search-row-meta">{r.site}</span>
      {r.note ? <span className="rd-search-web-note">{r.note}</span> : null}
      {loading ? (
        <span className="rd-search-web-status" role="status" aria-live="polite">
          <span className="rd-spinner" aria-hidden="true" />
          {stage ?? "Opening\u2026"}
        </span>
      ) : null}
      {cardError ? (
        <span className="rd-search-web-card-error">
          {cardError} Try another result.
        </span>
      ) : null}
    </button>
  );
}
