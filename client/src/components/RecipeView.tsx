/**
 * client/src/components/RecipeView.tsx
 *
 * Owns the completion logic. Two directions, both derived from the tree:
 *   completing a step marks everything upstream of it done
 *   undoing a step clears everything downstream, which is no longer valid
 */

import React, { useState, useMemo, useCallback, useRef } from "react";
import { computeLayout } from "../../../shared/layout";
import type { Entry } from "../lib/storage";
import Diagram from "./Diagram";
import StepsMode from "./StepsMode";
import { saveRecipeAsImage, slugForFile } from "../lib/exportImage";

interface Props {
  entry: Entry;
  onBack: () => void;
  onUpdate: (entry: Entry) => void;
  onDelete: () => void;
}

export default function RecipeView({ entry, onBack, onUpdate, onDelete }: Props) {
  const { recipe } = entry;
  const [hovered, setHovered] = useState<string | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);
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

  /** Everything that has to happen before `id` can happen. */
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

  // Hovering a later step shows the blast radius of clicking it.
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
      onUpdate({ ...entry, done: [...next] });
    },
    [done, parents, upstreamOf, entry, onUpdate]
  );

  const readyLabels: string[] = [];
  for (const s of recipe.sections)
    for (const n of s.nodes || [])
      if (!done.has(n.id) && (n.inputs || []).every((i) => done.has(i)))
        readyLabels.push(n.label);

  const pct = total ? Math.round((done.size / total) * 100) : 0;

  const saveAsImage = useCallback(async () => {
    if (!captureRef.current || savingImage) return;
    setSavingImage(true);
    try {
      await saveRecipeAsImage(captureRef.current, slugForFile(recipe.title));
    } catch (e) {
      window.alert(
        `Couldn't save that image: ${(e as Error).message || "unknown error"}`
      );
    } finally {
      setSavingImage(false);
    }
  }, [recipe.title, savingImage]);

  return (
    <div ref={captureRef} className="rd-capture">
      <div className="rd-crumb no-print">
        <button className="rd-back" onClick={onBack}>
          &larr; All recipes
        </button>
        <div className="rd-crumb-actions">
          <button
            className="rd-btn"
            onClick={() => onUpdate({ ...entry, done: [] })}
          >
            Clear progress
          </button>
          <button className="rd-btn" onClick={saveAsImage} disabled={savingImage}>
            {savingImage ? "Saving…" : "Save as Image"}
          </button>
          <button className="rd-btn rd-btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <header className="rd-head">
        <div className="rd-head-top">
          <h1 className="rd-title">{recipe.title}</h1>
          {recipe.yieldText ? (
            <span className="rd-yield">{recipe.yieldText}</span>
          ) : null}
        </div>

        <div className="rd-tabs rd-view-tabs no-print" role="tablist" aria-label="View">
          {(["diagram", "steps"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={viewMode === m}
              className={`rd-tab ${viewMode === m ? "is-on" : ""}`}
              onClick={() => onUpdate({ ...entry, mode: m })}
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
                  onUpdate({
                    ...entry,
                    servings: Math.max(1, (servings || 1) - 1),
                  })
                }
              >
                &minus;
              </button>
              <span className="rd-step-val">{servings}</span>
              <button
                className="rd-step-btn"
                aria-label="More servings"
                onClick={() =>
                  onUpdate({
                    ...entry,
                    servings: Math.min(99, (servings || 1) + 1),
                  })
                }
              >
                +
              </button>
            </div>
            {scale !== 1 ? (
              <span className="rd-scale-note">
                Amounts scaled &times;{scale.toFixed(2).replace(/\.?0+$/, "")}.
                Times and pan sizes still need your judgment.
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
          onUpdate={onUpdate}
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
            Amber means you can do it now. Click any step further right to
            jump ahead &mdash; everything it depends on gets marked done with
            it.
          </p>
        </>
      )}

      {recipe.sourceUrl ? (
        <p className="rd-source">
          From{" "}
          <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
            {recipe.source || recipe.sourceUrl}
          </a>
        </p>
      ) : null}
    </div>
  );
}
