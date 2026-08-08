/**
 * Focused.tsx — the new flow.
 *
 * Opening a recipe no longer drops you straight into a view with every
 * control visible. It asks once — Diagram or Step-by-step, as two large
 * cards — then gets out of the way: the chosen view becomes the only thing
 * on screen, filling the viewport top to bottom, with just a thin bar
 * (back + title + progress) above it. Switching views means going back
 * through the chooser, which is the point — this is a "which mode am I
 * cooking in right now" decision, not a toggle to flick mid-glance.
 *
 * Reuses the exact same Diagram/StepsMode components and completion logic
 * as Current.tsx — only the surrounding chrome differs.
 *
 * Design decision: "no scrolling needed" is delivered as "the chosen view
 * fills the screen and starts visible with no page-level scroll", not as a
 * hard guarantee against any scrollbar ever. The diagram's own horizontal
 * scroll-within-the-frame is original app behavior (ingredients pin left);
 * a recipe with many long sections can still scroll vertically inside the
 * content area below the bar. Steps mode never scrolls — it is always
 * exactly one card, centered.
 */
import "./_group.css";
import React, { useCallback, useMemo, useState } from "react";
import { computeLayout } from "./layout";
import type { Entry } from "./types";
import { SEED } from "./seed";
import Diagram from "./Diagram";
import StepsMode from "./StepsMode";

type Phase = "choose" | "diagram" | "steps";

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

export default function Focused() {
  const [entry, setEntry] = useState<Entry>(makeEntry);
  const [phase, setPhase] = useState<Phase>("choose");
  const { recipe } = entry;
  const [hovered, setHovered] = useState<string | null>(null);
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

  const pct = total ? Math.round((done.size / total) * 100) : 0;

  const pickMode = (m: "diagram" | "steps") => {
    setEntry((e) => ({ ...e, mode: m }));
    setPhase(m);
  };

  // ---- chooser -------------------------------------------------------
  if (phase === "choose") {
    return (
      <div className="rfx-page">
        <div className="rfx-choose-crumb">
          <button className="rd-back" type="button">
            &larr; All recipes
          </button>
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

  // ---- focused diagram / steps ----------------------------------------
  return (
    <div className="rfx-page">
      <div className="rfx-bar">
        <button className="rfx-bar-back" onClick={() => setPhase("choose")} title="Change view">
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
              onUpdate={setEntry}
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
          </div>
        )}
      </div>
    </div>
  );
}
