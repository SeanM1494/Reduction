/**
 * client/src/components/RecipeView.tsx
 *
 * Owns the completion logic. Two directions, both derived from the tree:
 *   completing a step marks everything upstream of it done
 *   undoing a step clears everything downstream, which is no longer valid
 *
 * Opening a recipe leads with a Diagram / Step-by-step chooser rather than
 * dropping straight into a view with every control on screen at once.
 * Once a mode is picked, the header collapses to a thin bar (back, title,
 * progress, overflow menu) and the chosen view fills the rest of the
 * available height. Going back to the chooser is deliberate — this is a
 * "which mode am I cooking in" decision, not a toggle to flick mid-glance.
 * `phase` is local, ephemeral state: App.tsx keys this component by
 * `entry.id`, so switching recipes remounts it and always lands back on
 * the chooser, matching what re-opening a recipe should feel like.
 */

import React, { useEffect, useMemo, useCallback, useRef, useState } from "react";
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

type Phase = "choose" | "diagram" | "steps";

const DiagramGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <rect x="1" y="4" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <rect x="1" y="21" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <rect x="20" y="12.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 8.5H15a2 2 0 0 1 2 2V17M10 25.5H15a2 2 0 0 1 2-2V17M17 17h3" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);

const StepsGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <rect x="4" y="3" width="26" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 8h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M17 17v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.5 4" />
    <rect x="4" y="21" width="26" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" opacity=".45" />
    <path d="M9 26h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
  </svg>
);

export default function RecipeView({ entry, onBack, onUpdate, onDelete }: Props) {
  const { recipe } = entry;
  const [phase, setPhase] = useState<Phase>("choose");
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const done = useMemo(() => new Set(entry.done || []), [entry.done]);

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

  const pickMode = useCallback(
    (m: "diagram" | "steps") => {
      onUpdate({ ...entry, mode: m });
      setPhase(m);
    },
    [entry, onUpdate]
  );

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (phase === "choose") {
    return (
      <div className="rfx-choose-page">
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
            <button className="rd-btn rd-btn-danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>

        <div className="rfx-choose-main">
          <p className="rfx-choose-eyebrow">{recipe.title}</p>
          <h1 className="rfx-choose-title">How do you want to cook this?</h1>

          <div className="rfx-choose-cards">
            <button className="rfx-choose-card" onClick={() => pickMode("diagram")}>
              <span className="rfx-choose-glyph"><DiagramGlyph /></span>
              <span className="rfx-choose-card-title">Diagram</span>
              <span className="rfx-choose-card-desc">
                See the whole dependency tree at once — what mixes into what,
                and what's ready right now.
              </span>
            </button>
            <button className="rfx-choose-card" onClick={() => pickMode("steps")}>
              <span className="rfx-choose-glyph"><StepsGlyph /></span>
              <span className="rfx-choose-card-title">Step-by-step</span>
              <span className="rfx-choose-card-desc">
                One instruction at a time, in order — ingredients folded
                right into the step that needs them.
              </span>
            </button>
          </div>

          {done.size > 0 ? (
            <p className="rfx-choose-resume">
              {done.size} / {total} already done — picking up where you left off.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={captureRef} className="rfx-page rd-capture">
      <div className="rfx-bar">
        <button
          className="rfx-bar-back no-print"
          onClick={() => setPhase("choose")}
          title="Change view"
        >
          &larr;
        </button>
        <span className="rfx-bar-title">{recipe.title}</span>
        <span className="rfx-bar-mode">{phase === "diagram" ? "Diagram" : "Steps"}</span>

        <div className="rfx-bar-progress" title={`${done.size} of ${total} done`}>
          <span className="rfx-bar-track">
            <span className="rfx-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="rfx-bar-count">
            {done.size}/{total}
          </span>
        </div>

        <div className="rfx-menu no-print" ref={menuRef}>
          <button
            className="rfx-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="More actions"
          >
            &#8942;
          </button>
          {menuOpen ? (
            <div className="rfx-menu-panel" role="menu">
              <button
                className="rfx-menu-item"
                role="menuitem"
                disabled={savingImage}
                onClick={() => {
                  setMenuOpen(false);
                  saveAsImage();
                }}
              >
                {savingImage ? "Saving…" : "Save as Image"}
              </button>
              <button
                className="rfx-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onUpdate({ ...entry, done: [] });
                }}
              >
                Clear progress
              </button>
              <button
                className="rfx-menu-item rfx-menu-item-danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                Delete recipe
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`rfx-content ${phase === "steps" ? "rfx-content-center" : ""}`}>
        {phase === "steps" ? (
          <div className="rfx-steps-wrap">
            <StepsMode
              key={entry.id}
              recipe={recipe}
              entry={entry}
              done={done}
              scale={scale}
              onToggle={toggle}
              onUpdate={onUpdate}
            />
          </div>
        ) : (
          <div className="rfx-diagram-wrap">
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
              jump ahead &mdash; everything it depends on gets marked done
              with it.
            </p>
          </div>
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
    </div>
  );
}
