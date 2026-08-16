/**
 * client/src/components/LandingPage.tsx — public landing page.
 *
 * Shown to a visitor with nothing saved yet (see App.tsx for the exact
 * gate). Composes the existing Diagram component with its own local,
 * ephemeral `done` state — this demo never touches the API, the library,
 * or Postgres. Refreshing the page resets it; the "Reset" button lets a
 * visitor replay it without refreshing.
 *
 * Deliberately does not fork Diagram.tsx/layout.ts — it drives the same
 * completion rules (mark upstream done, undo clears downstream) with its
 * own copy of that small bit of logic, same as RecipeView does for the
 * real library.
 */

import React, { useCallback, useMemo, useState } from "react";
import { computeLayout } from "../../../shared/layout";
import type { ThemeMode } from "../lib/theme";
import Diagram from "./Diagram";
import ThemeToggle from "./ThemeToggle";
import { DEMO_RECIPE, DEMO_PRECHECKED } from "../data/demo";

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onTryOwnRecipe: () => void;
}

export default function LandingPage({ themeMode, onThemeChange, onTryOwnRecipe }: Props) {
  const section = DEMO_RECIPE.sections[0];
  const [done, setDone] = useState<Set<string>>(() => new Set(DEMO_PRECHECKED));
  const [hovered, setHovered] = useState<string | null>(null);

  const { parents, inputs } = useMemo(() => {
    const parents = new Map<string, string>();
    const inputs = new Map<string, string[]>();
    const layout = computeLayout(section);
    layout.parentOf.forEach((v, k) => parents.set(k, v));
    for (const n of section.nodes) inputs.set(n.id, n.inputs || []);
    return { parents, inputs };
  }, [section]);

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

  const toggle = useCallback(
    (id: string) => {
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          let cur: string | undefined = id;
          while (cur) {
            next.delete(cur);
            cur = parents.get(cur);
          }
        } else {
          upstreamOf(id).forEach((u) => next.add(u));
        }
        return next;
      });
    },
    [parents, upstreamOf]
  );

  const preview = useMemo(() => {
    if (!hovered || done.has(hovered)) return new Set<string>();
    const up = upstreamOf(hovered);
    done.forEach((d) => up.delete(d));
    return up;
  }, [hovered, done, upstreamOf]);

  const reset = useCallback(() => setDone(new Set(DEMO_PRECHECKED)), []);

  return (
    <div className="rd-root rd-landing">
      <nav className="rd-nav no-print">
        <span className="rd-brand rd-brand-static">
          <img
            className="rd-logo"
            src="/brand/reduction-icon-transparent.svg"
            alt=""
            aria-hidden="true"
          />
          Reduction
        </span>
        <div className="rd-nav-right">
          <ThemeToggle mode={themeMode} onChange={onThemeChange} />
        </div>
      </nav>

      <div className="rd-shell">
        <div className="rd-landing-hero">
          <h1 className="rd-hero-title">Every recipe, as one diagram.</h1>
          <p className="rd-hero-sub">
            Paste a link and get a table that shows what mixes into what
            &mdash; and what you can do right now. Try it below, no account
            needed.
          </p>
        </div>

        <div className="rd-landing-demo">
          <div className="rd-landing-demo-head">
            <span className="rd-landing-demo-badge">
              Live demo &mdash; click an ingredient or step
            </span>
            <button className="rd-btn" onClick={reset}>
              Reset
            </button>
          </div>
          <Diagram
            section={section}
            index={0}
            done={done}
            preview={preview}
            scale={1}
            onToggle={toggle}
            onHover={setHovered}
          />
        </div>

        <div className="rd-landing-cta">
          <p className="rd-landing-cta-line">Have a recipe of your own to diagram?</p>
          <button className="rd-go" onClick={onTryOwnRecipe}>
            Try your own recipe
          </button>
        </div>
      </div>
    </div>
  );
}
