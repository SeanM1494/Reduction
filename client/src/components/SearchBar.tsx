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
                {webResults.map((r) => {
                  const isLoading = loadingUrl === r.url;
                  const cardError = cardErrors[r.url];
                  return (
                    <button
                      key={r.url}
                      type="button"
                      className={[
                        "rd-search-web-card",
                        isLoading ? "is-loading" : "",
                        cardError ? "has-error" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => pickWebResult(r)}
                      disabled={isLoading}
                    >
                      <span className="rd-search-row-title">{r.title}</span>
                      <span className="rd-search-row-meta">{r.site}</span>
                      {r.note ? (
                        <span className="rd-search-web-note">{r.note}</span>
                      ) : null}
                      {isLoading ? (
                        <span className="rd-search-web-status">
                          <span className="rd-spinner" aria-hidden="true" />
                          {"Reading this recipe\u2026"}
                        </span>
                      ) : null}
                      {cardError ? (
                        <span className="rd-search-web-card-error">
                          {cardError} Try another result.
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
