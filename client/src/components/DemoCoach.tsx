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

/**
 * A step that brings a new sentence with it holds longer — 600ms is fine for
 * watching a cell fill in, and far too fast to read a line of prose. Steps
 * that only continue the sentence already on screen keep the quick cadence,
 * so the narration paces the playback without dragging it out.
 */
const WATCH_NARRATED_MS = 1400;

/**
 * The demo, told as someone cooking it. Keyed by ingredient and step id
 * rather than by position, for the same reason the playback order is walked
 * from the graph instead of written out: renaming or reordering anything in
 * demo.ts drops the sentence for that id, it does not silently attach it to
 * the wrong step. Ids with no entry hold whatever sentence is already up,
 * which is what lets one line cover the run of ingredients feeding a step.
 *
 * Kept here rather than in demo.ts because the brief scoped these changes to
 * this file and LandingPage.tsx; keying by id is what prevents stranding, and
 * that holds wherever the map lives.
 */
const DEMO_NARRATION: Record<string, string> = {
  d1: "Olivia halved three avocados and scooped them into a bowl.",
  lime: "She squeezed in the lime and added a pinch of salt.",
  d2: "Mashed it until it was chunky, not smooth.",
  onion: "Onion, tomato, jalapeño and cilantro went in together.",
  d4: "She folded the two bowls into one.",
  d5: "Then a ten-minute rest, while the flavors came together.",
};

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
  // On a phone this is the first sentence anyone reads — the hero now sits
  // below the diagram — so it has to say what the thing IS before it says
  // what to do with it. An instruction alone ("Tap any ingredient…") assumes
  // a context the phone layout no longer provides above it.
  empty: "Guacamole, as a diagram. Tap any ingredient to check it off.",
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
  empty: "Guacamole, step by step. Check one off to bring up the next.",
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
): {
  playing: boolean;
  /** The narration sentence currently on screen, or null when not narrating.
   *  While this is set it stands in for the coach line entirely. */
  line: string | null;
  play: () => void;
  stop: () => void;
} {
  const [playing, setPlaying] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    // Dropped immediately and mid-sentence: an interrupted story has no
    // graceful ending to play out, and the coach line is the thing that
    // actually describes where the visitor now is.
    setLine(null);
  }, []);

  // A component unmounting mid-play must not leave timers writing into dead
  // state.
  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    stop();

    if (prefersReducedMotion()) {
      // One commit, and no narration: six sentences flashing past in as many
      // frames is worse than none, and there is no motion left to narrate.
      setDone(new Set([...prechecked, ...order]));
      return;
    }

    setPlaying(true);
    setDone(new Set(prechecked));

    // Delays accumulate rather than being a multiple of the index, because a
    // step carrying a new sentence is held longer than one that does not.
    let at = 0;
    order.forEach((id, i) => {
      const sentence = DEMO_NARRATION[id];
      at += sentence ? WATCH_NARRATED_MS : WATCH_STEP_MS;
      const t = window.setTimeout(() => {
        setDone(new Set([...prechecked, ...order.slice(0, i + 1)]));
        if (sentence) setLine(sentence);
      }, at);
      timers.current.push(t);
    });

    // The last sentence gets its full reading time before the coach line
    // takes back over with the completed-state copy.
    const end = window.setTimeout(() => {
      setPlaying(false);
      setLine(null);
    }, at + WATCH_NARRATED_MS);
    timers.current.push(end);
  }, [order, prechecked, setDone, stop]);

  return { playing, line, play, stop };
}

// --------------------------------------------------------------- pieces ----

/**
 * The coach line, which during "Watch it" is handed over to the narration
 * instead — one line, never both. Keyed by the sentence itself so React
 * swaps the node and the fade runs on every change, whether that is a new
 * stage or the next line of the story. This is the app's only polite live
 * region on this page.
 */
export function CoachLine({ text }: { text: string }) {
  return (
    <p className="rd-coach" aria-live="polite">
      <span key={text} className="rd-coach-text">
        {text}
      </span>
    </p>
  );
}

/**
 * Says "this is a sample" without saying it twice. Absolutely positioned onto
 * the demo card's top edge, so it reads as a label on the card and costs no
 * vertical space — the diagram below it has about 43px of clearance at
 * 390x844 and a flow-level marker would spend most of that (see CLAUDE.md).
 */
export function DemoTag() {
  return <span className="rd-demo-tag">Demo</span>;
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
