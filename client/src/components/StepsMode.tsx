/**
 * client/src/components/StepsMode.tsx — step-by-step cooking mode.
 *
 * Same data, same `done` set as the diagram — this just walks it as a card
 * sequence instead of a table. Card order is derived from computeLayout's
 * existing row order (depth-first), never from a separate traversal, so it
 * always agrees with the diagram.
 *
 * Every step is one card: ingredients (if any) live on the same card as the
 * step's action, framed as a short instruction — "In a bowl, add: ... Then
 * mix these together." — rather than a bare label with a separate prep card.
 *
 * Timers persist via an absolute `endsAt` timestamp on the recipe row, not
 * a running countdown — see the comment above the timer effect below.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, type Ingredient, type Recipe, type Step } from "../../../shared/layout";
import { formatAmount } from "../../../shared/amounts";
import type { Entry, StepTimer } from "../lib/storage";

interface StepCard {
  key: string;
  stepId: string;
  step: Step;
  sectionIndex: number;
  sectionName: string;
  /** Raw ingredient inputs for this step, in recipe order. Rendered as a
   *  checkable list on the same card as the step's action, however many
   *  there are — this is what used to be a separate "prep" card. */
  ingredients: Ingredient[];
  /** Labels of earlier steps this one consumes, for the quiet "builds on"
   *  line. Empty when every input is a raw ingredient. */
  fromLabels: string[];
  actionNumber: number;
}

function fmtTime(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Turns a step's raw label into a short lead-in + closing pair so the card
// reads like an instruction rather than a bare verb: "In a bowl, add: ...
// Then mix these together." Only steps with ingredients use this — steps
// with nothing to add just show their label directly (see render below).
function leadFor(label: string): string {
  return /\bmix\b/i.test(label) ? "In a bowl, add" : "Add";
}
function closingFor(label: string): string {
  const trimmed = label.trim();
  return /^mix$/i.test(trimmed) ? "mix these together" : trimmed;
}

// How long the "done" sweep takes — kept as one constant so the ghost's
// removal timeout can never drift out of sync with the CSS animation
// duration it is standing in for (see rd-steps-slide-* in index.css).
const SLIDE_MS = 420;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

interface Props {
  recipe: Recipe;
  entry: Entry;
  done: Set<string>;
  scale: number;
  onToggle: (id: string) => void;
  onUpdate: (entry: Entry) => void;
}

export default function StepsMode({ recipe, entry, done, scale, onToggle, onUpdate }: Props) {
  const { cards, totalActions } = useMemo(() => {
    const cards: StepCard[] = [];
    let actionNumber = 0;
    const totalActions = recipe.sections.reduce(
      (n, s) => n + (s.nodes?.length || 0),
      0
    );

    recipe.sections.forEach((section, sectionIndex) => {
      let layout;
      try {
        layout = computeLayout(section);
      } catch {
        return; // The diagram already shows this section's error.
      }
      const ingById = new Map(section.ingredients.map((i) => [i.id, i]));
      const nodeById = new Map(section.nodes.map((n) => [n.id, n]));

      // Same rows computeLayout hands the diagram — flattened and sorted
      // (row, col) reproduces the tree's depth-first order top to bottom.
      const opCells = layout.rows
        .flat()
        .filter((c) => c.kind === "op")
        .sort((a, b) => a.row - b.row || a.col - b.col);

      for (const cell of opCells) {
        const step = nodeById.get(cell.key);
        if (!step) continue;
        const ingredientInputs = (step.inputs || [])
          .map((id) => ingById.get(id))
          .filter((x): x is Ingredient => !!x);
        const fromLabels = (step.inputs || [])
          .map((id) => nodeById.get(id)?.label)
          .filter((x): x is string => !!x);

        actionNumber++;
        cards.push({
          key: step.id,
          stepId: step.id,
          step,
          sectionIndex,
          sectionName: section.name,
          ingredients: ingredientInputs,
          fromLabels,
          actionNumber,
        });
      }
    });

    return { cards, totalActions };
  }, [recipe]);

  // Position in the sequence. Recomputed only at mount (this component is
  // unmounted whenever the Diagram is showing instead, and remounted keyed
  // by recipe id — see RecipeView) so re-entering Steps mode always resumes
  // at the first thing not yet done, matching whatever happened in Diagram
  // mode meanwhile.
  const [cardIndex, setCardIndex] = useState(() => {
    const first = cards.findIndex((c) => !done.has(c.stepId));
    return first === -1 ? cards.length : first;
  });
  // Set when a parallel-work suggestion is followed, so "back to timer" is
  // always one tap regardless of how far the suggestion is browsed.
  const [returnIndex, setReturnIndex] = useState<number | null>(null);

  const goTo = useCallback((i: number) => {
    setCardIndex(Math.max(0, Math.min(cards.length, i)));
  }, [cards.length]);

  const card: StepCard | null = cardIndex < cards.length ? cards[cardIndex] : null;

  // ---- "done" sweep transition --------------------------------------------
  // Purely presentational: cardIndex (above) is the source of truth and
  // updates immediately, so done-state and resumption logic never wait on
  // this. When the index changes we freeze the outgoing card as a `ghost`
  // that sweeps off to the side while the new card sweeps in from the
  // opposite side — forward (Done) moves left-to-right through the card
  // sequence, so it exits left/enters right; Back mirrors it.
  //
  // The direction is computed synchronously during render (the "adjust
  // state while rendering" pattern) rather than in an effect, so the very
  // first paint of the new card already carries the right entrance class —
  // an effect-driven update would land one render too late and the first
  // frame would flash in with no animation.
  const [prevIndex, setPrevIndex] = useState(cardIndex);
  const [prevCard, setPrevCard] = useState<StepCard | null>(card);
  const [dir, setDir] = useState<"fwd" | "back" | null>(null);
  const [ghostCard, setGhostCard] = useState<StepCard | null>(null);
  const [ghostVisible, setGhostVisible] = useState(false);
  const [ghostToken, setGhostToken] = useState(0);

  if (cardIndex !== prevIndex) {
    const newDir: "fwd" | "back" = cardIndex > prevIndex ? "fwd" : "back";
    setPrevIndex(cardIndex);
    setPrevCard(card);
    if (!prefersReducedMotion()) {
      setDir(newDir);
      setGhostCard(prevCard);
      setGhostVisible(true);
      setGhostToken((t) => t + 1);
    }
  }

  useEffect(() => {
    if (!ghostVisible) return;
    const t = window.setTimeout(() => setGhostVisible(false), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [ghostVisible, ghostToken]);

  // ---- timer -------------------------------------------------------------
  // `entry.timer` stores {stepId, endsAt}, endsAt an absolute epoch ms. The
  // interval below only forces a re-render every second so the countdown
  // string stays live — it never itself decrements anything. Reloading (even
  // after fully closing the browser) recomputes remaining time from
  // endsAt - Date.now(), so it is correct however long the app was closed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const timer: StepTimer | null = entry.timer ?? null;
  const timerForCurrent = timer && card && timer.stepId === card.stepId ? timer : null;
  const remainingMs = timerForCurrent ? timerForCurrent.endsAt - Date.now() : null;
  const elapsed = remainingMs != null && remainingMs <= 0;

  // Fires the in-page alert + Web Notification exactly once per timer, the
  // moment it crosses from running to elapsed.
  const notifiedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!timerForCurrent || remainingMs == null || remainingMs > 0) return;
    const key = `${timerForCurrent.stepId}@${timerForCurrent.endsAt}`;
    if (notifiedForRef.current === key) return;
    notifiedForRef.current = key;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Timer done", {
          body: card?.step.label,
        });
      } catch {
        // Notifications are best-effort — the in-page banner still shows.
      }
    }
  }, [timerForCurrent, remainingMs, card]);

  const startTimer = useCallback(
    (step: Step) => {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        // Only ever asked here, on the user's own tap — never on page load.
        Notification.requestPermission().catch(() => {});
      }
      const endsAt = Date.now() + (step.minutes || 0) * 60_000;
      onUpdate({ ...entry, timer: { stepId: step.id, endsAt } });
    },
    [entry, onUpdate]
  );

  // ---- parallel work -------------------------------------------------------
  // Only offered while parked on a waiting (timed) card, and only steps
  // from OTHER sections — a different section is always a different tree,
  // so it can never be downstream of the current step.
  const parallelSuggestion = useMemo(() => {
    if (!card || !card.step.minutes) return null;
    const candidate = cards.find(
      (c) =>
        c.sectionIndex !== card.sectionIndex &&
        !done.has(c.stepId) &&
        (c.step.inputs || []).every((i) => done.has(i))
    );
    if (!candidate) return null;
    return { card: candidate, index: cards.indexOf(candidate) };
  }, [card, cards, done]);

  const jumpToSuggestion = useCallback(() => {
    if (!parallelSuggestion) return;
    setReturnIndex(cardIndex);
    goTo(parallelSuggestion.index);
  }, [parallelSuggestion, cardIndex, goTo]);

  const backToTimer = useCallback(() => {
    if (returnIndex == null) return;
    goTo(returnIndex);
    setReturnIndex(null);
  }, [returnIndex, goTo]);

  // ---- card actions --------------------------------------------------------
  const markDone = useCallback(
    (c: StepCard) => {
      if (!done.has(c.stepId)) onToggle(c.stepId);
      if (returnIndex != null && cardIndex === returnIndex) setReturnIndex(null);
      goTo(cardIndex + 1);
    },
    [done, onToggle, cardIndex, goTo, returnIndex]
  );

  if (cards.length === 0) {
    return <p className="rd-steps-empty">This recipe has no steps to cook through yet.</p>;
  }

  // Shared between the live card and its frozen ghost so the sweeping
  // outgoing card reads the same as it did a moment ago, not a blank shell.
  function stepBody(c: StepCard) {
    return (
      <>
        <p className="rd-steps-eyebrow">
          {c.sectionName} &middot; Step {c.actionNumber} of {totalActions}
        </p>

        {c.fromLabels.length ? (
          <p className="rd-steps-builds">Builds on: {c.fromLabels.join(", ")}</p>
        ) : null}

        {c.ingredients.length ? (
          <>
            <p className="rd-steps-lead">{leadFor(c.step.label)}:</p>
            <ul className="rd-steps-prep-list">
              {c.ingredients.map((ing) => {
                const isDone = done.has(ing.id);
                return (
                  <li key={ing.id}>
                    <button
                      type="button"
                      className={`rd-steps-prep-row ${isDone ? "is-done" : ""}`}
                      aria-pressed={isDone}
                      onClick={() => onToggle(ing.id)}
                    >
                      <span className="rd-steps-check" aria-hidden="true" />
                      <span className="rd-amount">{formatAmount(ing, scale)}</span>
                      <span className="rd-name">
                        {ing.name}
                        {ing.note ? <em className="rd-note">, {ing.note}</em> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="rd-steps-closing">Then {closingFor(c.step.label)}.</p>
          </>
        ) : (
          <h2 className="rd-steps-label">{c.step.label}</h2>
        )}
      </>
    );
  }

  const enterClass =
    dir === "fwd" ? "rd-steps-slide-in-fwd" : dir === "back" ? "rd-steps-slide-in-back" : "";
  const exitClass =
    dir === "fwd" ? "rd-steps-slide-out-fwd" : "rd-steps-slide-out-back";

  return (
    <div className="rd-steps">
      {returnIndex != null && cardIndex !== returnIndex ? (
        <button className="rd-steps-return" onClick={backToTimer}>
          &larr; Back to timer
        </button>
      ) : null}

      <div className="rd-steps-stage">
        {ghostVisible ? (
          <div className={`rd-steps-card rd-steps-card-ghost ${exitClass}`} aria-hidden="true">
            {ghostCard ? (
              stepBody(ghostCard)
            ) : (
              <p className="rd-steps-finished-label">Every step is done. Enjoy.</p>
            )}
          </div>
        ) : null}

        {!card ? (
          <div key="__finished" className={`rd-steps-card rd-steps-finished ${enterClass}`}>
            <p className="rd-steps-finished-label">Every step is done. Enjoy.</p>
            <div className="rd-steps-nav">
              <button className="rd-btn" onClick={() => goTo(cardIndex - 1)}>
                &larr; Back
              </button>
            </div>
          </div>
        ) : (
          <div key={card.key} className={`rd-steps-card ${enterClass}`}>
            {stepBody(card)}

            {card.step.minutes ? (
              <div className="rd-steps-timer">
                {timerForCurrent ? (
                  elapsed ? (
                    <p className="rd-steps-timer-alert" role="status">
                      Time&rsquo;s up &mdash; {card.step.label}
                    </p>
                  ) : (
                    <p className="rd-steps-timer-count">{fmtRemaining(remainingMs!)}</p>
                  )
                ) : (
                  <button className="rd-btn" onClick={() => startTimer(card.step)}>
                    Start timer ({fmtTime(card.step.minutes)})
                  </button>
                )}

                {parallelSuggestion ? (
                  <button className="rd-steps-parallel" onClick={jumpToSuggestion}>
                    While that&rsquo;s going &mdash; start {parallelSuggestion.card.sectionName}:{" "}
                    {parallelSuggestion.card.step.label}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="rd-steps-nav">
              {cardIndex > 0 ? (
                <button className="rd-btn" onClick={() => goTo(cardIndex - 1)}>
                  &larr; Back
                </button>
              ) : null}
              <button className="rd-btn rd-steps-primary" onClick={() => markDone(card)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
