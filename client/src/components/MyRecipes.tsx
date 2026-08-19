/**
 * client/src/components/MyRecipes.tsx — the library as a destination.
 *
 * A grid of cards under the paste box worked at three recipes and fell apart
 * at thirty (ROADMAP #8). This is the collection view: filter by meal type,
 * sort by what matters when deciding what to cook. All client-side over the
 * loaded library — at this scale a search index would be plumbing without a
 * payoff, and the entries are already in memory.
 */

import React, { useMemo, useState } from "react";
import type { Entry } from "../lib/storage";
import { countAll, countSteps, stepMinutes } from "../../../shared/amounts";
import {
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  primaryMealType,
  sanitizeMealTypes,
  type MealType,
} from "../../../shared/mealTypes";

type SortKey = "added" | "cooked" | "time" | "source" | "type" | "rating";
type Filter = MealType | "all" | "untagged" | "favourites";

interface Props {
  library: Entry[];
  onOpen: (id: string) => void;
  /** Sends the user to the Find tab — the empty state's call to action. */
  onFind: () => void;
}

/** `added` stays first and therefore stays the default. Favourites-first
 *  looks obviously better and has no data behind it yet — deliberately left
 *  alone until real libraries exist to judge it against. */
const SORTS: Array<[SortKey, string]> = [
  ["added", "Recently added"],
  ["cooked", "Recently cooked"],
  ["time", "Total time"],
  ["source", "Source"],
  ["type", "Meal type"],
  ["rating", "Favourites first"],
];

/** Sum of every step's minutes — the honest lower bound on hands-on-to-done.
 *  Null when no step carries a time, which sorts after everything timed. */
function totalMinutes(entry: Entry): number | null {
  let sum = 0;
  let any = false;
  for (const s of entry.recipe.sections ?? []) {
    for (const n of s.nodes ?? []) {
      const m = stepMinutes(n.minutes);
      if (m != null) {
        sum += m;
        any = true;
      }
    }
  }
  return any ? sum : null;
}

const lastCooked = (e: Entry): number =>
  e.cooked && e.cooked.length ? Math.max(...e.cooked) : 0;

const ratingOf = (e: Entry): number => (typeof e.rating === "number" ? e.rating : 0);

export default function MyRecipes({ library, onOpen, onFind }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("added");

  const hasFavourites = useMemo(() => library.some((e) => ratingOf(e) === 1), [library]);

  const hasUntagged = useMemo(
    () => library.some((e) => sanitizeMealTypes(e.recipe.mealTypes).length === 0),
    [library]
  );

  /** Which of the eight are worth offering: a chip that filters to nothing
   *  is a dead end, so only types the library actually contains render. */
  const presentTypes = useMemo(() => {
    const present = new Set<MealType>();
    for (const e of library) for (const t of sanitizeMealTypes(e.recipe.mealTypes)) present.add(t);
    return MEAL_TYPES.filter((t) => present.has(t));
  }, [library]);

  const shown = useMemo(() => {
    const matches = (e: Entry): boolean => {
      if (filter === "all") return true;
      if (filter === "favourites") return ratingOf(e) === 1;
      const types = sanitizeMealTypes(e.recipe.mealTypes);
      if (filter === "untagged") return types.length === 0;
      // The primary drives sorting and display; ALL types widen filters.
      return types.includes(filter);
    };
    const list = library.filter(matches);
    const by: Record<SortKey, (a: Entry, b: Entry) => number> = {
      added: (a, b) => b.savedAt - a.savedAt,
      cooked: (a, b) => lastCooked(b) - lastCooked(a),
      time: (a, b) => {
        const ta = totalMinutes(a);
        const tb = totalMinutes(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      },
      source: (a, b) => (a.recipe.source ?? "￿").localeCompare(b.recipe.source ?? "￿"),
      type: (a, b) =>
        (primaryMealType(a.recipe.mealTypes) ?? "￿").localeCompare(
          primaryMealType(b.recipe.mealTypes) ?? "￿"
        ),
      // Favourites, then unrated, then the rejects — and within each, the
      // most recently added. A 👎 recipe is not hidden by this sort, only
      // ranked last; hiding it would make it unfindable.
      rating: (a, b) => ratingOf(b) - ratingOf(a) || b.savedAt - a.savedAt,
    };
    return [...list].sort(by[sort]);
  }, [library, filter, sort]);

  if (library.length === 0) {
    return (
      <div className="rd-empty">
        Nothing saved yet. Anything you diagram lands here, with your progress
        kept.{" "}
        <button className="rd-btn rd-empty-cta" onClick={onFind}>
          Find a recipe
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="rd-lib-head">
        <h2 className="rd-lib-title">My Recipes</h2>
        <span className="rd-lib-count">
          {shown.length === library.length
            ? `${library.length} ${library.length === 1 ? "recipe" : "recipes"}`
            : `${shown.length} of ${library.length}`}
        </span>
      </div>

      {/* One row, horizontally scrollable at 320px rather than wrapped — a
          wrapped chip row two deep pushes the actual recipes below the fold. */}
      <div className="rd-chip-row no-print" role="tablist" aria-label="Filter by meal type">
        <FilterChip current={filter} value="all" label="All" onPick={setFilter} />
        {hasFavourites ? (
          <FilterChip current={filter} value="favourites" label="★ Favourites" onPick={setFilter} />
        ) : null}
        {presentTypes.map((t) => (
          <FilterChip
            key={t}
            current={filter}
            value={t}
            label={MEAL_TYPE_LABELS[t]}
            onPick={setFilter}
          />
        ))}
        {hasUntagged ? (
          <FilterChip current={filter} value="untagged" label="Untagged" onPick={setFilter} />
        ) : null}
      </div>

      <div className="rd-sort-row no-print">
        <label className="rd-sort-label" htmlFor="rd-sort">
          Sort
        </label>
        <select
          id="rd-sort"
          className="rd-sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="rd-empty">Nothing matches that filter.</div>
      ) : (
        <div className="rd-grid">
          {shown.map((entry) => {
            const total = countAll(entry.recipe);
            const doneN = (entry.done || []).length;
            const pct = total ? Math.round((doneN / total) * 100) : 0;
            const types = sanitizeMealTypes(entry.recipe.mealTypes);
            const primary = types[0] ?? null;
            const mins = totalMinutes(entry);
            return (
              <button key={entry.id} className="rd-card" onClick={() => onOpen(entry.id)}>
                <span className="rd-card-top">
                  {primary ? (
                    <span className="rd-card-type">{MEAL_TYPE_LABELS[primary]}</span>
                  ) : (
                    <span className="rd-card-type is-untagged">Untagged</span>
                  )}
                  {types.length > 1 ? (
                    <span className="rd-card-type-more">+{types.length - 1}</span>
                  ) : null}
                  {/* Favourites are marked; a 👎 is NOT shown back. A library
                      that displays your rejects at you is a worse library —
                      the rating still sorts and filters, it just does not
                      decorate. */}
                  {ratingOf(entry) === 1 ? (
                    <span className="rd-card-fav" aria-label="Favourite">
                      ★
                    </span>
                  ) : null}
                  {mins !== null ? (
                    <span className="rd-card-time">
                      {mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min` : ""}` : `${mins} min`}
                    </span>
                  ) : null}
                </span>
                <span className="rd-card-title">{entry.recipe.title}</span>
                <span className="rd-card-meta">
                  {countSteps(entry.recipe)} steps
                  {entry.recipe.source ? ` · ${entry.recipe.source}` : ""}
                </span>
                <span className="rd-card-bar">
                  <span className="rd-card-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="rd-card-pct">
                  {pct === 0 ? "Not started" : pct === 100 ? "Done" : `${pct}%`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function FilterChip({
  current,
  value,
  label,
  onPick,
}: {
  current: Filter;
  value: Filter;
  label: string;
  onPick: (f: Filter) => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={current === value}
      className={`rd-chip ${current === value ? "is-on" : ""}`}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  );
}
