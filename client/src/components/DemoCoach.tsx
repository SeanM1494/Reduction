/**
 * client/src/components/DemoCoach.tsx — the landing demo's teaching layer.
 *
 * The demo already showed what the app does. This makes it teach how it
 * works, through interaction alone: no modal, no overlay tour, nothing to
 * dismiss before the diagram is usable.
 *
 * Four parts, all driven by the same `done` set the diagram is driven by:
 *   useCoachStage   one sentence that reacts to where the visitor actually is
 *   useCoachTips    two contextual tips, once each, never two at once
 *   CoachLegend     the three cell states, as real cells
 *   useWatchPlayer  the autoplay sequence behind "Watch it"
 *
 * This layer wraps Diagram — it never reaches into it. No querySelector on
 * Diagram's class names, no anchoring to a specific cell, no imports from
 * layout.ts. Everything here is derived from the recipe's own graph and the
 * `done` set, so a Diagram refactor cannot break the coaching.
 *
 * On "amber": Diagram marks every unchecked ingredient `is-ready` too, but
 * every style rule for that class is scoped to .rd-op / .rd-fin, so only
 * steps ever actually render amber — ingredients keep --ing-bg. The legend
 * below therefore shows step cells, and the tips only fire on operations,
 * which is what a visitor sees turn amber.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Section } from "../../../shared/layout";

/** Steps advance this fast during autoplay. Slow enough to read a label. */
const WATCH_STEP_MS = 600;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// ---------------------------------------------------------------- graph ----

/**
 * The bits of the section's shape the coaching needs, none of which require
 * layout.ts: which ids are operations, what each consumes, and which single
 * step is the one both branches converge into.
 */
export interface DemoGraph {
  opIds: string[];
  ingredientIds: string[];
  inputsOf: Map<string, string[]>;
  /** The first step fed by two or more *steps* — "fold together" in the
   *  guacamole demo. Null for a recipe that never branches. */
  joinId: string | null;
  /** Ops that are already ready before anyone touches anything, so the amber
   *  tip never fires for a state the visitor did not cause. */
  initiallyReadyOps: Set<string>;
  allIds: string[];
}

export function buildDemoGraph(section: Section, prechecked: string[]): DemoGraph {
  const opIds = section.nodes.map((n) => n.id);
  const ingredientIds = section.ingredients.map((i) => i.id);
  const isOp = new Set(opIds);
  const inputsOf = new Map<string, string[]>();
  for (const n of section.nodes) inputsOf.set(n.id, n.inputs || []);

  const joinId =
    section.nodes.find((n) => (n.inputs || []).filter((i) => isOp.has(i)).length >= 2)
      ?.id ?? null;

  const start = new Set(prechecked);
  const initiallyReadyOps = new Set(
    opIds.filter((id) => (inputsOf.get(id) || []).every((i) => start.has(i)))
  );

  return {
    opIds,
    ingredientIds,
    inputsOf,
    joinId,
    initiallyReadyOps,
    allIds: [...ingredientIds, ...opIds],
  };
}

/** Ops whose every input is checked off — the amber ones. */
function readyOps(graph: DemoGraph, done: Set<string>): Set<string> {
  return new Set(
    graph.opIds.filter(
      (id) => !done.has(id) && (graph.inputsOf.get(id) || []).every((i) => done.has(i))
    )
  );
}

// ---------------------------------------------------------------- stage ----

export type CoachStage =
  | "empty"
  | "firstIngredient"
  | "stepReady"
  | "converging"
  | "complete";

const STAGE_TEXT: Record<CoachStage, string> = {
  empty: "Tap any ingredient to check it off — the diagram works out what you can do next.",
  firstIngredient:
    "Each box to the right lights up as soon as everything feeding into it is checked.",
  stepReady: "That step turned amber because everything it needs is now done.",
  converging: "Both branches are finished, so folding them together is all that's left.",
  complete: "That's the whole recipe — no scrolling back up a wall of paragraphs.",
};

/**
 * Card mode has no grid, no columns and nothing amber, so the three stages
 * that describe those get a second phrasing. The rest say the same thing in
 * either view and are not repeated here.
 */
const STEPS_STAGE_TEXT: Partial<Record<CoachStage, string>> = {
  empty: "Work down the cards — checking one off brings up the next thing you can do.",
  firstIngredient: "A card only comes up once everything it needs is checked off.",
  stepReady: "That step unlocked because everything it needs is now done.",
};

/**
 * Where the visitor is, derived fresh from `done` every render — never
 * stored, so Reset and Watch both land on the right sentence for free.
 */
export function useCoachStage(
  graph: DemoGraph,
  done: Set<string>,
  prechecked: string[],
  view: "diagram" | "steps"
): { stage: CoachStage; text: string } {
  return useMemo(() => {
    const stage: CoachStage = (() => {
      if (graph.allIds.every((id) => done.has(id))) return "complete";

      if (graph.joinId) {
        const feeders = (graph.inputsOf.get(graph.joinId) || []).filter((i) =>
          graph.opIds.includes(i)
        );
        if (feeders.length >= 2 && feeders.every((f) => done.has(f))) return "converging";
      }

      // Any op that became ready beyond the ones ready at mount means the
      // visitor has unlocked something themselves.
      const ready = readyOps(graph, done);
      for (const id of ready) {
        if (!graph.initiallyReadyOps.has(id)) return "stepReady";
      }
      if (graph.opIds.some((id) => done.has(id))) return "stepReady";

      const start = new Set(prechecked);
      if (graph.ingredientIds.some((id) => done.has(id) && !start.has(id))) {
        return "firstIngredient";
      }
      return "empty";
    })();

    const text =
      (view === "steps" ? STEPS_STAGE_TEXT[stage] : undefined) ?? STAGE_TEXT[stage];
    return { stage, text };
  }, [graph, done, prechecked, view]);
}

// ----------------------------------------------------------------- tips ----

export type TipId = "amber" | "jump";

const TIP_TEXT: Record<TipId, string> = {
  amber: "Amber means you can do this now — everything it depends on is already checked.",
  jump: "You can skip ahead: click any step further right and everything it needs gets checked along with it.",
};

/**
 * Two tips, one at a time, once each, each dismissed by the next interaction.
 *
 * The whole lifecycle is driven by watching `done` change rather than by
 * callbacks from the click handlers, so autoplay, Reset and ordinary clicks
 * all flow through one path. `shown` is a ref, not state: re-showing a tip is
 * never correct, so it must not participate in re-rendering.
 *
 * Not aria-live. The coach line is the polite region; a tip appearing at the
 * same moment the line changes would queue two announcements for one action.
 */
export function useCoachTips(
  graph: DemoGraph,
  done: Set<string>,
  opts: { suspended: boolean }
): { tip: TipId | null; text: string | null; resetTips: () => void } {
  const [tip, setTip] = useState<TipId | null>(null);
  const shown = useRef<Set<TipId>>(new Set());
  const prevReady = useRef<Set<string> | null>(null);
  const suspended = opts.suspended;

  useEffect(() => {
    const ready = readyOps(graph, done);

    // First run establishes the baseline without firing: whatever is amber at
    // mount is the starting position, not something the visitor unlocked.
    if (prevReady.current === null) {
      prevReady.current = ready;
      return;
    }
    const previous = prevReady.current;
    prevReady.current = ready;

    if (suspended) return;

    // An active tip is dismissed by this change, whatever it was. The next
    // change is the earliest anything new can appear.
    if (tip !== null) {
      setTip(null);
      return;
    }

    const newlyReady = [...ready].filter(
      (id) => !previous.has(id) && !graph.initiallyReadyOps.has(id)
    );

    if (!shown.current.has("amber") && newlyReady.length > 0) {
      shown.current.add("amber");
      setTip("amber");
      return;
    }

    // Only worth suggesting once a jump is actually available: a step that
    // isn't done and isn't reachable yet is exactly what "skip ahead" means.
    const jumpTarget = graph.opIds.some(
      (id) => !done.has(id) && !ready.has(id)
    );
    if (shown.current.has("amber") && !shown.current.has("jump") && jumpTarget) {
      shown.current.add("jump");
      setTip("jump");
    }
    // `tip` is read to decide dismissal, but re-running on its own change
    // would dismiss a tip the instant it appeared — this must only run when
    // `done` moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, graph, suspended]);

  const resetTips = useCallback(() => {
    shown.current = new Set();
    prevReady.current = null;
    setTip(null);
  }, []);

  return { tip, text: tip ? TIP_TEXT[tip] : null, resetTips };
}

// ---------------------------------------------------------------- watch ----

/**
 * Autoplay for "Watch it". Always replays from the demo's opening position so
 * the sequence reads the same every time, whatever the visitor had checked.
 *
 * Cancellation is the point: any interaction stops it mid-run and leaves the
 * progress it made in place, rather than snapping back or fighting the click.
 */
export function useWatchPlayer(
  order: string[],
  prechecked: string[],
  setDone: (next: Set<string>) => void
): { playing: boolean; play: () => void; stop: () => void } {
  const [playing, setPlaying] = useState(false);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
  }, []);

  // A component unmounting mid-play must not leave timers writing into dead
  // state.
  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    stop();

    if (prefersReducedMotion()) {
      setDone(new Set([...prechecked, ...order]));
      return;
    }

    setPlaying(true);
    setDone(new Set(prechecked));
    order.forEach((_, i) => {
      const t = window.setTimeout(
        () => {
          setDone(new Set([...prechecked, ...order.slice(0, i + 1)]));
          if (i === order.length - 1) setPlaying(false);
        },
        WATCH_STEP_MS * (i + 1)
      );
      timers.current.push(t);
    });
  }, [order, prechecked, setDone, stop]);

  return { playing, play, stop };
}

// --------------------------------------------------------------- pieces ----

/**
 * The coach line. Keyed by stage so React swaps the node and the CSS
 * transition runs on each new sentence rather than cross-fading text in
 * place. This is the app's only polite live region on this page.
 */
export function CoachLine({ stage, text }: { stage: CoachStage; text: string }) {
  return (
    <p className="rd-coach" aria-live="polite">
      <span key={stage} className="rd-coach-text">
        {text}
      </span>
    </p>
  );
}

/** A tip, or the empty slot it occupies. Silent to screen readers — see
 *  useCoachTips. The slot is always rendered so a tip appearing never
 *  reflows the diagram below it. */
export function CoachTip({ text }: { text: string | null }) {
  return (
    <div className="rd-tip-slot" aria-hidden="true">
      {text ? <p className="rd-tip">{text}</p> : null}
    </div>
  );
}

/**
 * The three states, as actual cells: a one-row table reusing rd-table /
 * rd-cell / rd-op so these can never drift from what the diagram renders.
 * Rebuilding them out of divs with hand-copied colors is exactly the drift
 * this avoids.
 *
 * The cells are decorative duplicates of styling shown above, so the table is
 * hidden from assistive tech and a plain sentence carries the same content.
 */
export function CoachLegend() {
  return (
    <div className="rd-legend">
      <table className="rd-table rd-legend-table" aria-hidden="true">
        <tbody>
          <tr>
            <td className="rd-cell rd-op is-pending">
              <span className="rd-op-label">not yet</span>
            </td>
            <td className="rd-cell rd-op is-ready">
              <span className="rd-mark" />
              <span className="rd-op-label">do this now</span>
            </td>
            <td className="rd-cell rd-op is-done">
              <span className="rd-mark" />
              <span className="rd-op-label">done</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="rd-sr-only">
        Steps show three states: grey when something it needs is still
        outstanding, amber when it can be done now, and struck through in
        green once it is done.
      </p>
    </div>
  );
}
