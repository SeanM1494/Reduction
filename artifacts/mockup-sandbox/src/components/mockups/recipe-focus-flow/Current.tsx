/**
 * Current.tsx — baseline.
 *
 * Extracted from client/src/components/RecipeView.tsx (the tab toggle,
 * header chrome, servings stepper, progress meta, source link) plus
 * Diagram.tsx / StepsMode.tsx, ported to local useState instead of the
 * server-backed Entry the real app persists via /api/library. Logic
 * (upstream/downstream completion, scaling, progress %) is unchanged.
 *
 * This is what opening a recipe looks like today: the Diagram/Steps tab
 * toggle plus every header control stay visible at once, no matter which
 * view you're in.
 */
import "./_group.css";
import React, { useCallback, useMemo, useState } from "react";
import { computeLayout } from "./layout";
import type { Entry } from "./types";
import { SEED } from "./seed";
import Diagram from "./Diagram";
import StepsMode from "./StepsMode";

function makeEntry(): Entry {
  return {
    id: "seed",
    recipe: SEED,
    done: [],
    servings: null,
    mode: "diagram",
    timer: null,
    savedAt: Date.now(),
  };
}

export default function Current() {
  const [entry, setEntry] = useState<Entry>(makeEntry);
  const { recipe } = entry;
  const [hovered, setHovered] = useState<string | null>(null);
  const done = useMemo(() => new Set(entry.done || []), [entry.done]);
  const viewMode = entry.mode ?? "diagram";

  const baseServings = recipe.servings;
  const servings = entry.servings ?? baseServings;
  const scale = baseServings && servings ? servings / baseServings : 1;

  const { parents, inputs, total } = useMemo(() => {
    const parents = new Map<string, string>();
    const inputs = new Map<string, string[]>();
    let total = 0;
    for (const s of recipe.sections) {
      try {
        const l = computeLayout(s);
        l.parentOf.forEach((v, k) => parents.set(k, v));
        total += (s.ingredients || []).length + (s.nodes || []).length;
        for (const n of s.nodes || []) inputs.set(n.id, n.inputs || []);
      } catch {
        // The section renders its own error.
      }
    }
    return { parents, inputs, total };
  }, [recipe]);

  const upstreamOf = useCallback(
    (id: string) => {
      const acc = new Set<string>();
      (function walk(cur: string) {
        if (acc.has(cur)) return;
        acc.add(cur);
        (inputs.get(cur) || []).forEach(walk);
      })(id);
      return acc;
    },
    [inputs]
  );

  const preview = useMemo(() => {
    if (!hovered || done.has(hovered)) return new Set<string>();
    const up = upstreamOf(hovered);
    done.forEach((d) => up.delete(d));
    return up;
  }, [hovered, done, upstreamOf]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(done);
      if (next.has(id)) {
        let cur: string | undefined = id;
        while (cur) {
          next.delete(cur);
          cur = parents.get(cur);
        }
      } else {
        upstreamOf(id).forEach((u) => next.add(u));
      }
      setEntry((e) => ({ ...e, done: [...next] }));
    },
    [done, parents, upstreamOf]
  );

  const readyLabels: string[] = [];
  for (const s of recipe.sections)
    for (const n of s.nodes || [])
      if (!done.has(n.id) && (n.inputs || []).every((i) => done.has(i)))
        readyLabels.push(n.label);

  const pct = total ? Math.round((done.size / total) * 100) : 0;

  return (
    <div className="rd-root">
      <nav className="rd-nav">
        <button className="rd-brand" type="button">
          <span className="rd-logo" aria-hidden="true" />
          Reduction
        </button>
      </nav>

      <div className="rd-shell">
        <div className="rd-capture">
          <div className="rd-crumb">
            <button className="rd-back" type="button">
              &larr; All recipes
            </button>
            <div className="rd-crumb-actions">
              <button className="rd-btn" onClick={() => setEntry((e) => ({ ...e, done: [] }))}>
                Clear progress
              </button>
              <button className="rd-btn" type="button">Save as Image</button>
              <button className="rd-btn rd-btn-danger" type="button">Delete</button>
            </div>
          </div>

          <header className="rd-head">
            <div className="rd-head-top">
              <h1 className="rd-title">{recipe.title}</h1>
              {recipe.yieldText ? <span className="rd-yield">{recipe.yieldText}</span> : null}
            </div>

            <div className="rd-tabs rd-view-tabs" role="tablist" aria-label="View">
              {(["diagram", "steps"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={viewMode === m}
                  className={`rd-tab ${viewMode === m ? "is-on" : ""}`}
                  onClick={() => setEntry((e) => ({ ...e, mode: m }))}
                >
                  {m === "diagram" ? "Diagram" : "Steps"}
                </button>
              ))}
            </div>

            {baseServings ? (
              <div className="rd-servings">
                <span className="rd-servings-label">Servings</span>
                <div className="rd-stepper">
                  <button
                    className="rd-step-btn"
                    aria-label="Fewer servings"
                    onClick={() =>
                      setEntry((e) => ({ ...e, servings: Math.max(1, (e.servings ?? baseServings ?? 1) - 1) }))
                    }
                  >
                    &minus;
                  </button>
                  <span className="rd-step-val">{servings}</span>
                  <button
                    className="rd-step-btn"
                    aria-label="More servings"
                    onClick={() =>
                      setEntry((e) => ({ ...e, servings: Math.min(99, (e.servings ?? baseServings ?? 1) + 1) }))
                    }
                  >
                    +
                  </button>
                </div>
                {scale !== 1 ? (
                  <span className="rd-scale-note">
                    Amounts scaled &times;{scale.toFixed(2).replace(/\.?0+$/, "")}. Times and pan
                    sizes still need your judgment.
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="rd-progress">
              <div className="rd-bar">
                <div className="rd-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="rd-progress-meta">
                <span className="rd-count">
                  {done.size} / {total}
                </span>
                <span className="rd-ready-line">
                  {total > 0 && done.size === total
                    ? "Done."
                    : readyLabels.length
                      ? `Ready now: ${readyLabels.slice(0, 3).join(", ")}`
                      : "Check off ingredients to unlock the first steps"}
                </span>
              </div>
            </div>
          </header>

          {viewMode === "steps" ? (
            <StepsMode
              key={entry.id}
              recipe={recipe}
              entry={entry}
              done={done}
              scale={scale}
              onToggle={toggle}
              onUpdate={setEntry}
            />
          ) : (
            <>
              {recipe.sections.map((s, i) => (
                <Diagram
                  key={i}
                  index={i}
                  section={s}
                  done={done}
                  preview={preview}
                  scale={scale}
                  onToggle={toggle}
                  onHover={setHovered}
                />
              ))}
              <p className="rd-hint">
                Amber means you can do it now. Click any step further right to jump ahead —
                everything it depends on gets marked done with it.
              </p>
            </>
          )}

          {recipe.sourceUrl ? (
            <p className="rd-source">
              From <a href={recipe.sourceUrl}>{recipe.source || recipe.sourceUrl}</a>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
