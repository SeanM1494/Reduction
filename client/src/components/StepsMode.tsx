/**
 * client/src/components/StepsMode.tsx — step-by-step cooking mode.
 *
 * Same data, same `done` set as the diagram — this just walks it as a card
 * sequence instead of a table. Card order is derived from computeLayout's
 * existing row order (depth-first), never from a separate traversal, so it
 * always agrees with the diagram.
 *
 * Timers persist via an absolute `endsAt` timestamp on the recipe row, not
 * a running countdown — see the comment above the timer effect below.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, type Ingredient, type Recipe, type Step } from "../../../shared/layout";
import { formatAmount } from "../../../shared/amounts";
import type { Entry, StepTimer } from "../lib/storage";

interface PrepCard {
  kind: "prep";
  key: string;
  stepId: string;
  sectionIndex: number;
  ingredients: Ingredient[];
}

interface ActionCard {
  kind: "action";
  key: string;
  stepId: string;
  step: Step;
  sectionIndex: number;
  sectionName: string;
  /** Set when the step takes 0 or 1 ingredient inputs — named inline instead
   *  of getting its own prep card. */
  inlineIngredient: Ingredient | null;
  /** Labels of earlier steps this one consumes, for the quiet "builds on"
   *  line. Empty when every input is an ingredient. */
  fromLabels: string[];
  actionNumber: number;
}

type Card = PrepCard | ActionCard;

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

function isPrepSatisfied(card: PrepCard, done: Set<string>): boolean {
  return card.ingredients.every((i) => done.has(i.id));
}

function isCardSatisfied(card: Card, done: Set<string>): boolean {
  return card.kind === "prep" ? isPrepSatisfied(card, done) : done.has(card.stepId);
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
    const cards: Card[] = [];
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
        if (ingredientInputs.length >= 2) {
          cards.push({
            kind: "prep",
            key: `${step.id}__prep`,
            stepId: step.id,
            sectionIndex,
            ingredients: ingredientInputs,
          });
        }
        cards.push({
          kind: "action",
          key: step.id,
          stepId: step.id,
          step,
          sectionIndex,
          sectionName: section.name,
          inlineIngredient: ingredientInputs.length === 1 ? ingredientInputs[0] : null,
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
    const first = cards.findIndex((c) => !isCardSatisfied(c, done));
    return first === -1 ? cards.length : first;
  });
  // Set when a parallel-work suggestion is followed, so "back to timer" is
  // always one tap regardless of how far the suggestion is browsed.
  const [returnIndex, setReturnIndex] = useState<number | null>(null);

  const goTo = useCallback((i: number) => {
    setCardIndex(Math.max(0, Math.min(cards.length, i)));
  }, [cards.length]);

  const card: Card | null = cardIndex < cards.length ? cards[cardIndex] : null;

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
  const timerForCurrent = timer && card?.kind === "action" && timer.stepId === card.stepId
    ? timer
    : null;
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
          body: card?.kind === "action" ? card.step.label : undefined,
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
  // Only offered while parked on a waiting (timed) action card, and only
  // steps from OTHER sections — a different section is always a different
  // tree, so it can never be downstream of the current step.
  const parallelSuggestion = useMemo(() => {
    if (!card || card.kind !== "action" || !card.step.minutes) return null;
    const candidate = cards.find(
      (c) =>
        c.kind === "action" &&
        c.sectionIndex !== card.sectionIndex &&
        !done.has(c.stepId) &&
        (c.step.inputs || []).every((i) => done.has(i))
    ) as ActionCard | undefined;
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
  const markPrepReady = useCallback(
    (c: PrepCard) => {
      c.ingredients.forEach((i) => {
        if (!done.has(i.id)) onToggle(i.id);
      });
      goTo(cardIndex + 1);
    },
    [done, onToggle, cardIndex, goTo]
  );

  const markActionDone = useCallback(
    (c: ActionCard) => {
      if (!done.has(c.stepId)) onToggle(c.stepId);
      if (returnIndex != null && cardIndex === returnIndex) setReturnIndex(null);
      goTo(cardIndex + 1);
    },
    [done, onToggle, cardIndex, goTo, returnIndex]
  );

  if (cards.length === 0) {
    return <p className="rd-steps-empty">This recipe has no steps to cook through yet.</p>;
  }

  return (
    <div className="rd-steps">
      {returnIndex != null && cardIndex !== returnIndex ? (
        <button className="rd-steps-return" onClick={backToTimer}>
          &larr; Back to timer
        </button>
      ) : null}

      {!card ? (
        <div className="rd-steps-card rd-steps-finished">
          <p className="rd-steps-finished-label">Every step is done. Enjoy.</p>
          <div className="rd-steps-nav">
            <button className="rd-btn" onClick={() => goTo(cardIndex - 1)}>
              &larr; Back
            </button>
          </div>
        </div>
      ) : card.kind === "prep" ? (
        <div className="rd-steps-card">
          <p className="rd-steps-eyebrow">Prep</p>
          <ul className="rd-steps-prep-list">
            {card.ingredients.map((ing) => {
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
          <div className="rd-steps-nav">
            <button className="rd-btn" onClick={() => goTo(cardIndex - 1)}>
              &larr; Back
            </button>
            <button className="rd-btn rd-steps-primary" onClick={() => markPrepReady(card)}>
              Ready
            </button>
          </div>
        </div>
      ) : (
        <div className="rd-steps-card">
          <p className="rd-steps-eyebrow">
            {card.sectionName} &middot; Step {card.actionNumber} of {totalActions}
          </p>
          <h2 className="rd-steps-label">{card.step.label}</h2>
          {card.inlineIngredient ? (
            <p className="rd-steps-inline-ing">
              with {formatAmount(card.inlineIngredient, scale)} {card.inlineIngredient.name}
              {card.inlineIngredient.note ? `, ${card.inlineIngredient.note}` : ""}
            </p>
          ) : null}
          {card.fromLabels.length ? (
            <p className="rd-steps-builds">Builds on: {card.fromLabels.join(", ")}</p>
          ) : null}

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
            <button className="rd-btn" onClick={() => goTo(cardIndex - 1)}>
              &larr; Back
            </button>
            <button className="rd-btn rd-steps-primary" onClick={() => markActionDone(card)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
