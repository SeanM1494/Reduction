/**
 * client/src/components/LandingPage.tsx — public landing page.
 *
 * Shown to a visitor with nothing saved yet (see App.tsx for the exact
 * gate). Composes the existing Diagram and StepsMode components with its
 * own local, ephemeral `done` state — this demo never touches the API, the
 * library, or Postgres. Refreshing the page resets it; the "Reset" button
 * lets a visitor replay it without refreshing.
 *
 * Deliberately does not fork Diagram.tsx/StepsMode.tsx/layout.ts — it drives
 * the same completion rules (mark upstream done, undo clears downstream) with
 * its own copy of that small bit of logic, same as RecipeView does for the
 * real library. The teaching layer around it lives in DemoCoach.tsx and is
 * likewise a wrapper: it reads the same `done` set and never reaches into
 * either view's DOM.
 *
 * The Diagram/Steps toggle here is not RecipeView's chooser. RecipeView is a
 * page shell around an Entry — back link, delete, clear progress, save as
 * image — none of which mean anything for a demo with nothing to delete. So
 * the toggle is local and the reuse happens one level down, at StepsMode,
 * with a synthetic in-memory entry that never reaches storage.ts.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { computeLayout } from "../../../shared/layout";
import type { ThemeMode } from "../lib/theme";
import type { Entry, StepTimer } from "../lib/storage";
import Diagram from "./Diagram";
import StepsMode from "./StepsMode";
import ThemeToggle from "./ThemeToggle";
import { DEMO_RECIPE, DEMO_PRECHECKED } from "../data/demo";
import {
  buildDemoGraph,
  useCoachStage,
  useCoachTips,
  useWatchPlayer,
  CoachLine,
  CoachTip,
  CoachLegend,
  DemoTag,
} from "./DemoCoach";

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onTryOwnRecipe: () => void;
  /** A URL typed into the completed demo's inline CTA. Carried through
   *  sign-up so extraction can run as soon as the account exists — see
   *  lib/pendingUrl.ts. */
  onSubmitUrl: (url: string) => void;
  onSignIn: () => void;
  /** Recipes saved on this device with no account. Anonymous saving is a
   *  supported state, not an edge case — it is what the demo's funnel
   *  produces — so it needs a visible door or those recipes become
   *  unreachable after a reload. */
  savedCount: number;
  onViewLibrary: () => void;
  /** This browser has had an account before — so it is signed out, not new,
   *  and its saved recipes are behind sign-in rather than gone. Someone
   *  arriving for the first time is told no such thing. */
  returning: boolean;
}

type DemoMode = "diagram" | "steps";

export default function LandingPage({
  themeMode,
  onThemeChange,
  onTryOwnRecipe,
  onSubmitUrl,
  onSignIn,
  savedCount,
  onViewLibrary,
  returning,
}: Props) {
  const section = DEMO_RECIPE.sections[0];
  const [done, setDone] = useState<Set<string>>(() => new Set(DEMO_PRECHECKED));
  const [hovered, setHovered] = useState<string | null>(null);
  const [mode, setMode] = useState<DemoMode>("diagram");
  const [timer, setTimer] = useState<StepTimer | null>(null);
  const [url, setUrl] = useState("");

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

  const graph = useMemo(() => buildDemoGraph(section, DEMO_PRECHECKED), [section]);

  /**
   * Autoplay order: a post-order walk from the root, so every input is
   * emitted before the step that consumes it. Derived from the recipe rather
   * than written out, so editing demo.ts can't leave a stale sequence behind.
   * Anything already checked at the start is dropped — it is part of the
   * baseline the player replays from.
   */
  const watchOrder = useMemo(() => {
    const start = new Set(DEMO_PRECHECKED);
    const out: string[] = [];
    const seen = new Set<string>();
    (function walk(id: string) {
      if (seen.has(id)) return;
      seen.add(id);
      (inputs.get(id) || []).forEach(walk);
      if (!start.has(id)) out.push(id);
    })(section.root);
    return out;
  }, [section, inputs]);

  const { playing, line: narration, play, stop } = useWatchPlayer(
    watchOrder,
    DEMO_PRECHECKED,
    setDone
  );
  const { stage, text: coachText } = useCoachStage(graph, done, DEMO_PRECHECKED, mode);
  // Both tips describe the grid — amber cells, stepping rightwards — so they
  // are held (not spent) while card mode is up, and while autoplay is driving.
  const { text: tipText, resetTips } = useCoachTips(graph, done, {
    suspended: playing || mode !== "diagram",
  });

  const toggle = useCallback(
    (id: string) => {
      stop();
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
    [parents, upstreamOf, stop]
  );

  const preview = useMemo(() => {
    if (!hovered || done.has(hovered)) return new Set<string>();
    const up = upstreamOf(hovered);
    done.forEach((d) => up.delete(d));
    return up;
  }, [hovered, done, upstreamOf]);

  const reset = useCallback(() => {
    stop();
    resetTips();
    setTimer(null);
    setDone(new Set(DEMO_PRECHECKED));
  }, [stop, resetTips]);

  const pickMode = useCallback(
    (m: DemoMode) => {
      stop();
      setMode(m);
    },
    [stop]
  );

  /**
   * StepsMode reads `entry` only for its timer, and writes back through
   * onUpdate for the same reason. Synthesising one here keeps card mode on a
   * demo that has no Entry, without touching storage.ts — nothing built here
   * is ever handed to saveLibrary.
   */
  const demoEntry: Entry = useMemo(
    () => ({
      id: "demo",
      recipe: DEMO_RECIPE,
      done: [...done],
      servings: DEMO_RECIPE.servings,
      mode,
      timer,
      savedAt: 0,
    }),
    [done, mode, timer]
  );

  const urlRef = useRef<HTMLInputElement>(null);
  const submitUrl = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      urlRef.current?.focus();
      return;
    }
    onSubmitUrl(trimmed);
  }, [url, onSubmitUrl]);

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
          <span className="rd-brand-word">Reduction</span>
        </span>
        <div className="rd-nav-right">
          <button className="rd-btn rd-signin-nav" onClick={onSignIn}>
            Sign in
          </button>
          <ThemeToggle mode={themeMode} onChange={onThemeChange} />
        </div>
      </nav>

      {/* One flex column whose two reading orders are each set deliberately
          (see .rd-landing-flow in index.css). On a phone the diagram comes
          first and the pitch after it: a 664px viewport cannot hold copy and
          a legible diagram both, and the demo argues better than the copy
          does. On desktop the copy leads, as it should when there is room. */}
      <div className="rd-shell rd-landing-flow">
        {/* State, not pitch — so it stays above the diagram in both orders.
            It only renders for a returning or already-saving visitor, so a
            first-time arrival (and a shared link) pays nothing for it. */}
        {savedCount > 0 || returning ? (
          <div className="rd-landing-notes">
            {savedCount > 0 ? (
              <p className="rd-saved-note">
                <strong>
                  {savedCount} recipe{savedCount === 1 ? "" : "s"} saved on this
                  device.
                </strong>{" "}
                <button className="rd-linkish" onClick={onViewLibrary}>
                  View {savedCount === 1 ? "it" : "them"}
                </button>
              </p>
            ) : (
              <p className="rd-signed-out-note">
                You&rsquo;re signed out &mdash;{" "}
                <button className="rd-linkish" onClick={onSignIn}>
                  sign in to see your saved recipes
                </button>
                .
              </p>
            )}
          </div>
        ) : null}

        <div className="rd-landing-hero">
          <h1 className="rd-hero-title">Every recipe, as one diagram.</h1>
          <p className="rd-hero-sub">
            Paste a link and get a table that shows what mixes into what
            &mdash; and what you can do right now. Try it below, no account
            needed.
          </p>
        </div>

        <div className="rd-landing-demo">
          <DemoTag />
          <div className="rd-landing-demo-head">
            <div className="rd-demo-modes" role="group" aria-label="Demo view">
              <button
                className={`rd-seg ${mode === "diagram" ? "is-on" : ""}`}
                aria-pressed={mode === "diagram"}
                onClick={() => pickMode("diagram")}
              >
                Diagram
              </button>
              <button
                className={`rd-seg ${mode === "steps" ? "is-on" : ""}`}
                aria-pressed={mode === "steps"}
                onClick={() => pickMode("steps")}
              >
                Steps
              </button>
            </div>
            <div className="rd-demo-actions">
              <button
                className="rd-btn"
                onClick={playing ? stop : play}
                aria-live="off"
              >
                {playing ? "Stop" : "Watch it"}
              </button>
              <button className="rd-btn" onClick={reset}>
                Reset
              </button>
            </div>
          </div>

          {/* The narration stands in for the coach line while it is running,
              never alongside it. Interrupting playback clears it in the same
              commit that cancels the timers, so the coach line is back before
              the next frame. */}
          <CoachLine text={narration ?? coachText} />
          <CoachTip text={tipText} />

          {mode === "diagram" ? (
            <>
              <Diagram
                section={section}
                index={0}
                done={done}
                preview={preview}
                scale={1}
                onToggle={toggle}
                onHover={setHovered}
              />
              <CoachLegend />
            </>
          ) : (
            <div className="rd-demo-steps">
              <StepsMode
                recipe={DEMO_RECIPE}
                entry={demoEntry}
                done={done}
                scale={1}
                onToggle={toggle}
                onUpdate={(next) => setTimer(next.timer)}
              />
            </div>
          )}
        </div>

        {stage === "complete" ? (
          <div className="rd-landing-cta rd-cta-done">
            <p className="rd-landing-cta-line">
              Now do it with a recipe you actually want to cook.
            </p>
            <form
              className="rd-cta-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitUrl();
              }}
            >
              <input
                ref={urlRef}
                className="rd-cta-input"
                type="url"
                inputMode="url"
                placeholder="Paste a recipe link"
                aria-label="Recipe URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button className="rd-go" type="submit">
                Diagram it
              </button>
            </form>
          </div>
        ) : (
          <div className="rd-landing-cta">
            <p className="rd-landing-cta-line">Have a recipe of your own to diagram?</p>
            <button className="rd-go" onClick={onTryOwnRecipe}>
              Try your own recipe
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
