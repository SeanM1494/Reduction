/**
 * client/src/components/DemoCoach.tsx — the landing demo's teaching layer.
 *
 * The demo already showed what the app does. This makes it teach how it
 * works, through interaction alone: no modal, no overlay tour, nothing to
 * dismiss before the diagram is usable.
 *
 * Three parts, all driven by the same `done` set the diagram is driven by:
 *   useGuideLine    the instruction for where the visitor actually is, set
 *                   like a Step-by-Step heading under "Demo · Step 2 of 4"
 *   CoachLegend     the three cell states, as real cells
 *   useWatchPlayer  the autoplay sequence behind "Watch it"
 *
 * The instruction follows the phone's guided demo (Oct 1, ROADMAP "Website
 * demo parity"): nothing checked at the start, the avocados, then halve and
 * scoop as the one amber step, then the last step. Unlike the phone's it is
 * DERIVED from `done` every render, never stored, so a tap it did not ask
 * for simply leaves the same instruction up, and Reset and Watch it land on
 * the right one for free.
 *
 * This layer wraps Diagram — it never reaches into it. No querySelector on
 * Diagram's class names, no anchoring to a specific cell, no imports from
 * layout.ts. Everything here is derived from the recipe's own graph and the
 * `done` set, so a Diagram refactor cannot break the coaching.
 *
 * On "amber": Diagram marks every unchecked ingredient `is-ready` too, but
 * every style rule for that class is scoped to .rd-op / .rd-fin, so only
 * steps ever actually render amber — ingredients keep --ing-bg. The legend
 * below therefore shows step cells.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Section } from "../shared/layout";

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
 * layout.ts: which ids are operations, what each consumes, the last step,
 * and the step the guide makes ready first.
 */
export interface DemoGraph {
  opIds: string[];
  inputsOf: Map<string, string[]>;
  root: string;
  /** The first step fed by ingredients alone, with the fewest of them —
   *  "halve and scoop", fed by the avocados. Found from the graph the same
   *  way the phone's guide finds it, so the words cannot name a step that
   *  is not the one turning amber. */
  starter: string;
  starterLabel: string;
  starterInputs: string[];
  /** The starter's ingredients by name, as the instruction says them. */
  starterInputNames: string;
}

export function buildDemoGraph(section: Section): DemoGraph {
  const opIds = section.nodes.map((n) => n.id);
  const inputsOf = new Map<string, string[]>();
  for (const n of section.nodes) inputsOf.set(n.id, n.inputs || []);

  const ingredientName = new Map(section.ingredients.map((i) => [i.id, i.name]));
  const fedByIngredients = section.nodes.filter(
    (n) => (n.inputs || []).length > 0 && (n.inputs || []).every((i) => ingredientName.has(i))
  );
  const starter = fedByIngredients.reduce(
    (a, b) => ((b.inputs || []).length < (a.inputs || []).length ? b : a),
    fedByIngredients[0]
  );
  const starterInputs = [...(starter.inputs || [])];

  return {
    opIds,
    inputsOf,
    root: section.root ?? opIds[opIds.length - 1],
    starter: starter.id,
    starterLabel: starter.label,
    starterInputs,
    starterInputNames: starterInputs.map((i) => ingredientName.get(i)).join(" and "),
  };
}

// ---------------------------------------------------------------- guide ----

export interface GuideLine {
  /** "Step 2 of 4", or "Step-by-Step" in card mode. Shown after "Demo ·". */
  label: string;
  text: string;
  /** The last step is checked, so the whole recipe is. */
  complete: boolean;
}

/** The diagram's four steps. The phone's guide has six: its "read" step
 *  needs a Next button and its Step-by-Step step clears the checks first,
 *  and this page has neither; card mode gets its own line instead. */
const GUIDE_TOTAL = 4;

const FINISH_TEXT = "That's it. Add your own recipe.";
const STEPS_TEXT = "Tap Next Step to check off each card in cooking order.";

/** Every instruction this graph can show, for sizing the box to the
 *  longest so a new step never moves the diagram under a finger. */
export function guideTexts(g: DemoGraph): string[] {
  return [
    `Tap the ${g.starterInputNames} to check them off.`,
    `Amber means ready. Tap ${g.starterLabel}.`,
    "Tap the last step. It checks off everything before it.",
    FINISH_TEXT,
    STEPS_TEXT,
  ];
}

export function guideLine(
  g: DemoGraph,
  done: Set<string>,
  view: "diagram" | "steps"
): GuideLine {
  const texts = guideTexts(g);
  const at = (n: number): GuideLine => ({
    label: `Step ${n} of ${GUIDE_TOTAL}`,
    text: texts[n - 1],
    complete: n === GUIDE_TOTAL,
  });
  if (done.has(g.root)) return at(4);
  if (view === "steps") return { label: "Step-by-Step", text: STEPS_TEXT, complete: false };
  if (done.has(g.starter)) return at(3);
  if (g.starterInputs.every((i) => done.has(i))) return at(2);
  return at(1);
}

/** Where the visitor is, derived fresh from `done` every render. */
export function useGuideLine(
  graph: DemoGraph,
  done: Set<string>,
  view: "diagram" | "steps"
): GuideLine {
  return useMemo(() => guideLine(graph, done, view), [graph, done, view]);
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
 * The instruction, under "Demo · Step 2 of 4", set in the Step-by-Step
 * card's heading face. During "Watch it" the narration takes its place and
 * the label says so — one line, never both.
 *
 * The box is a one-cell grid holding every line it can show, unseen, with
 * the current one on top: it is always as tall as the longest at this width,
 * so a new step never moves the diagram under a finger, and no JavaScript
 * measures anything. The visible line is keyed by its text so the fade runs
 * on every change. This is the app's only polite live region on this page.
 */
export function CoachLine({
  label,
  text,
  sizers,
}: {
  label: string;
  text: string;
  sizers: string[];
}) {
  return (
    <div className="rd-coach">
      <p className="rd-coach-eyebrow">
        <span className="rd-coach-demo">Demo</span> &middot; {label}
      </p>
      <div className="rd-coach-box">
        {sizers.map((t) => (
          <p key={`sizer:${t}`} className="rd-coach-text rd-coach-sizer" aria-hidden="true">
            {t}
          </p>
        ))}
        <p className="rd-coach-live" aria-live="polite">
          <span key={text} className="rd-coach-text">
            {text}
          </span>
        </p>
      </div>
    </div>
  );
}

/** The narration sentences, for sizing the coach box (see CoachLine). */
export const NARRATION_TEXTS: string[] = Object.values(DEMO_NARRATION);

/**
 * Says "this is a sample" without saying it twice. Absolutely positioned onto
 * the demo card's top edge, so it reads as a label on the card and costs no
 * vertical space — the diagram below it has about 43px of clearance at
 * 390x844 and a flow-level marker would spend most of that (see CLAUDE.md).
 */
export function DemoTag() {
  return <span className="rd-demo-tag">Demo</span>;
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
