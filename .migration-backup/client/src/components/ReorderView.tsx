/**
 * client/src/components/ReorderView.tsx — "do this branch first."
 *
 * Card order is derived — a depth-first walk plus the section sort in
 * shared/sequence.ts — and that is correct: a step can never be asked for
 * before its inputs. But where the tree is genuinely indifferent (two
 * branches meeting at a fold, sections with no name link between them) the
 * walk picks an order and the cook has no say. This view is the say.
 *
 * WHAT IT WRITES, AND THE OVERLAP THAT IS DELIBERATE
 *
 * It writes `entry.order`, never the tree. Branch order ALSO exists at the
 * tree level, as the step sheet's Order list (`reorderInputs`) — same fact,
 * different scope, and the split is the same one this codebase has already
 * made twice: `recipe.servings` is a correction everyone inherits while
 * `entry.servings` is tonight's count, and the recipe is shared while
 * `entry.rating` is one person's opinion. The Order list changes the recipe
 * for everyone and moves the diagram rows, because input order is what the
 * diagram draws; this view changes one entry's cards and nothing else. If
 * you find yourself merging the two, you are re-fighting a settled decision.
 *
 * WHAT MAY BE DRAGGED IS DECIDED BY sequence.ts, NOT HERE
 *
 * `branchChoices` and `freeSectionIndices` come from the same module as the
 * walk that will honour the result — the single-authority rule from
 * validMoveTargets, with the walk as the authority. A row only gets a grip
 * when the walk can actually honour a move of it, so movability is visible
 * BEFORE the gesture, not discovered at the drop. (That is one better than
 * the ingredient drag, which lights targets at pickup; see ROADMAP for
 * whether it should adopt the grip too.) Sections inside a name link get no
 * grip at all — the topological sort could not be violated anyway, but
 * offering a drag the sort would then quietly correct is rejecting after the
 * drop, which is the thing this view promises not to do.
 */

import { useMemo } from "react";
import type { Recipe } from "../../../shared/layout";
import type { Entry } from "../lib/storage";
import {
  applyBranchPreference,
  branchChoices,
  freeSectionIndices,
  pruneOrderPreference,
  sectionOrder,
  stepSequence,
  type OrderPreference,
} from "../../../shared/sequence";
import { useIngredientDrag } from "../lib/useIngredientDrag";

interface Props {
  recipe: Recipe;
  entry: Entry;
  done: Set<string>;
  onUpdate: (entry: Entry) => void;
  onClose: () => void;
}

/** Row ids carry their kind, because a section and a step can share a DOM
 *  surface but not a drop rule. */
const secId = (i: number) => `sec:${i}`;
const stepRowId = (id: string) => `step:${id}`;

export default function ReorderView({ recipe, entry, done, onUpdate, onClose }: Props) {
  const order = entry.order ?? null;

  const model = useMemo(() => {
    // The display IS the walk's answer under the current preference, so what
    // the list shows and what the cards will do cannot disagree.
    const secIdx = sectionOrder(recipe, order ?? undefined);
    const free = freeSectionIndices(recipe);

    // Effective branch order per convergence, preference already applied —
    // the same candidate-section move the walk itself makes.
    const effective = recipe.sections.map((s) =>
      order?.branches ? applyBranchPreference(s, order.branches) : s
    );
    const choices = branchChoices({ ...recipe, sections: effective });
    const rootToChoice = new Map<string, { stepId: string; branchRoots: string[]; consumerLabel: string }>();
    for (const c of choices) {
      const consumer = effective[c.sectionIndex].nodes.find((n) => n.id === c.stepId);
      for (const root of c.branchRoots) {
        rootToChoice.set(root, {
          stepId: c.stepId,
          branchRoots: c.branchRoots,
          consumerLabel: consumer?.label ?? "",
        });
      }
    }

    const sectionsMovable = free.size >= 1 && recipe.sections.length >= 2;
    const sections = secIdx.map((i) => ({
      index: i,
      name: recipe.sections[i].name,
      movable: sectionsMovable && free.has(i),
      steps: stepSequence(effective[i]).map((id) => {
        const node = effective[i].nodes.find((n) => n.id === id)!;
        return { id, label: node.label, choice: rootToChoice.get(id) ?? null };
      }),
    }));

    const anyMovable =
      sections.some((s) => s.movable) || choices.length > 0;

    return { sections, choices, anyMovable, displayedSecIdx: secIdx };
  }, [recipe, order]);

  const commit = (next: OrderPreference | null) => {
    // Pruned on write, here as well as on the server — the same place done
    // is reconciled. What is stored is only ever things that exist.
    onUpdate({ ...entry, order: pruneOrderPreference(recipe, next) });
  };

  /**
   * Standard list displacement: the dragged thing takes the target's
   * position — before it when coming from below, after it when coming from
   * above — so first and last are reachable by dropping on each other.
   */
  const displace = <T,>(xs: T[], from: number, to: number): T[] => {
    const out = [...xs];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x);
    return out;
  };

  const drag = useIngredientDrag({
    recipe,
    enabled: true,
    onMove: (fromId, toId) => {
      if (fromId.startsWith("sec:") && toId.startsWith("sec:")) {
        const shown = model.displayedSecIdx;
        const from = shown.indexOf(Number(fromId.slice(4)));
        const to = shown.indexOf(Number(toId.slice(4)));
        if (from < 0 || to < 0 || from === to) return;
        const nextIdx = displace(shown, from, to);
        commit({
          ...(order ?? {}),
          sections: nextIdx.map((i) => recipe.sections[i].name),
        });
        return;
      }
      if (fromId.startsWith("step:") && toId.startsWith("step:")) {
        const a = fromId.slice(5);
        const b = toId.slice(5);
        // Find the convergence both roots belong to — the only drop the
        // targets allowed.
        for (const s of model.sections) {
          const row = s.steps.find((x) => x.id === a);
          if (!row?.choice) continue;
          const roots = row.choice.branchRoots;
          const from = roots.indexOf(a);
          const to = roots.indexOf(b);
          if (from < 0 || to < 0) continue;
          commit({
            ...(order ?? {}),
            branches: {
              ...(order?.branches ?? {}),
              [row.choice.stepId]: displace(roots, from, to),
            },
          });
          return;
        }
      }
    },
    resolve: {
      // Both target sets restate what the walk can honour: any other section
      // for a free section (a free section is in no link, so every position
      // in the displayed order is realisable), and only the sibling roots of
      // the same convergence for a branch.
      targetsFor: (_r, id) => {
        if (id.startsWith("sec:")) {
          return model.displayedSecIdx
            .map(secId)
            .filter((x) => x !== id);
        }
        const choice = model.sections
          .flatMap((s) => s.steps)
          .find((x) => x.id === id.slice(5))?.choice;
        if (!choice) return [];
        return choice.branchRoots.map(stepRowId).filter((x) => x !== id);
      },
      targetAttr: "data-reorder-id",
      labelSelector: ".rd-ro-label",
      // This list scrolls the page only; there is no inner frame.
      frameSelector: null,
    },
  });

  const rowState = (id: string) => {
    if (!drag.dragging) return "";
    if (drag.dragging === id) return "is-lifted";
    if (drag.validTargets.has(id))
      return drag.hoverTarget === id ? "is-drop-over is-drop-ok" : "is-drop-ok";
    return "is-drop-no";
  };

  return (
    <div className="rd-reorder">
      <div className="rd-ro-head">
        <h2 className="rd-ro-title">Cooking order</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      {model.anyMovable ? (
        <>
          <p className="rd-ro-hint">
            Press and hold a row with a grip, then drop it on another. Only
            work the recipe leaves interchangeable can move — everything else
            is fixed by what depends on what.
          </p>
          {entry.order ? (
            <button className="rd-btn rd-ro-reset" onClick={() => commit(null)}>
              Reset to the recipe&rsquo;s own order
            </button>
          ) : null}
        </>
      ) : (
        /* The common case, and a real answer rather than an apology: a linear
           recipe, or linked sections, leave exactly one valid order. A list
           that offered drags and refused them all would be worse than saying
           so. */
        <p className="rd-ro-empty" role="status">
          Every step here depends on the one before it &mdash; there&rsquo;s
          nothing to reorder. When a recipe has independent branches or
          sections, this is where you choose what to cook first.
        </p>
      )}

      <ol className="rd-ro-list">
        {model.sections.map((s) => (
          <li key={s.index} className="rd-ro-section">
            {recipe.sections.length > 1 ? (
              <div
                className={`rd-ro-row rd-ro-sec-row ${s.movable ? "is-movable" : ""} ${rowState(secId(s.index))}`}
                data-reorder-id={s.movable || drag.dragging?.startsWith("sec:") ? secId(s.index) : undefined}
                onPointerDown={
                  s.movable ? (e) => drag.onPointerDown(e, secId(s.index)) : undefined
                }
              >
                {s.movable ? (
                  <span className="rd-ro-grip" aria-hidden="true">
                    &#8942;&#8942;
                  </span>
                ) : (
                  <span className="rd-ro-grip rd-ro-grip-off" aria-hidden="true" />
                )}
                <span className="rd-ro-label">{s.name}</span>
                {!s.movable ? (
                  <span className="rd-ro-pin">used by another section</span>
                ) : null}
              </div>
            ) : null}

            <ol className="rd-ro-steps">
              {s.steps.map((step) => (
                <li key={step.id}>
                  <div
                    className={`rd-ro-row rd-ro-step-row ${step.choice ? "is-movable" : ""} ${rowState(stepRowId(step.id))}`}
                    data-reorder-id={step.choice ? stepRowId(step.id) : undefined}
                    onPointerDown={
                      step.choice
                        ? (e) => drag.onPointerDown(e, stepRowId(step.id))
                        : undefined
                    }
                  >
                    {step.choice ? (
                      <span className="rd-ro-grip" aria-hidden="true">
                        &#8942;&#8942;
                      </span>
                    ) : (
                      <span className="rd-ro-grip rd-ro-grip-off" aria-hidden="true" />
                    )}
                    <span className="rd-ro-label">
                      {done.has(step.id) ? (
                        <s className="rd-ro-done">{step.label}</s>
                      ) : (
                        step.label
                      )}
                    </span>
                    {step.choice ? (
                      <span className="rd-ro-branch">
                        branch into &ldquo;{step.choice.consumerLabel}&rdquo;
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      {drag.ghost ? (
        <div
          className="rd-drag-ghost"
          style={{ left: drag.ghost.x, top: drag.ghost.y, width: drag.ghost.width }}
          aria-hidden="true"
        >
          {drag.ghost.label}
        </div>
      ) : null}
    </div>
  );
}
