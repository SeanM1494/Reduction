/**
 * client/src/components/Diagram.tsx — one section as one table, plus a finish strip.
 *
 * Cell states are derived, never stored: a step is ready when all its inputs
 * are done, pending otherwise.
 *
 * The tail of a recipe is different in kind from the rest. Once every
 * ingredient has joined the mixture, the remaining steps — bake, chill, slice —
 * consume the whole thing and branch nothing. In the table those render as
 * absurdly tall full-height cells that say nothing a chip in a row wouldn't,
 * while forcing extra columns and more horizontal scrolling. So they come out
 * of the table into a finish strip underneath, and once the tree part is done
 * the table tucks away and the strip takes over.
 */

import React, { useLayoutEffect, useRef, useState } from "react";
import { computeLayout, type Section, type Step } from "../../../shared/layout";
import { formatAmount, formatMinutes } from "../../../shared/amounts";

/**
 * Columns shade deeper to the right, so stage depth reads before interaction.
 * Mixed from the theme's own card/ink tokens (not a fixed hue) so the same
 * progression works unmodified in light, dark and colorblind mode.
 */
const depthTint = (d: number) => {
  const pct = Math.min(d, 12) * 1.1;
  return `color-mix(in srgb, var(--card) ${100 - pct}%, var(--ink) ${pct}%)`;
};

/**
 * How long this section's height takes to settle after a tap.
 *
 * Picked from a measured tap cadence, not taste. The handoff tap collapses
 * 406px on the guacamole demo at 390px, and the next thing the visitor reaches
 * for — the finish strip — sits directly under the table, so it travels the
 * whole distance. At the old 1s the strip still had 200px to go when a normal
 * next tap landed on it. At 380ms it is fully settled by 384ms, which is
 * shorter than any realistic re-target.
 *
 * A deliberate delay before starting was tried here and measured worse, not
 * better: holding the tuck back by 200ms split the movement into two chained
 * animations — the rows collapsing, then the table swapping for its chip —
 * and pushed the settle from 384ms out to 522ms, leaving 44px still moving at
 * 300ms against 19px without it. It also bought nothing it was supposed to:
 * React's onClick fires on pointerup, so the finger is already leaving the
 * glass before the first pixel moves. One uninterrupted ease beats two.
 */
const SWAP_MS = 380;

/**
 * Edit mode, supplied by RecipeView and absent everywhere else.
 *
 * Optional on purpose: the landing demo drives this component directly and
 * must never gain an editor, so "no edit prop" has to mean "behaves exactly as
 * it always did" rather than "editing defaults to off". Nothing in DemoCoach
 * or LandingPage changes because of this.
 */
export interface DiagramEdit {
  active: boolean;
  /** A tap in edit mode opens fields instead of marking anything done. */
  onTapCell: (id: string) => void;
  /** A tap on the section's own title. Diagram does not know what a section
   *  is addressed by — the caller closes over that — so this takes nothing. */
  onTapSection: () => void;
  onPointerDown: (e: React.PointerEvent, ingredientId: string) => void;
  pressing: string | null;
  dragging: string | null;
  validTargets: Set<string>;
  hoverTarget: string | null;
}

interface Props {
  section: Section;
  index: number;
  done: Set<string>;
  preview: Set<string>;
  scale: number;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
  edit?: DiagramEdit;
}

export default function Diagram({
  section,
  index,
  done,
  preview,
  scale,
  onToggle,
  onHover,
  edit,
}: Props) {
  const [override, setOverride] = useState(false);
  // Ids the user has manually reopened after they qualified for collapse.
  // Once reopened they stay open for the life of this component — unchecking
  // a step inside a collapsed branch also reopens it, since that step's
  // parent chain (the collapsed step itself) gets un-done by the same click.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /**
   * Smooths the two things that change this section's rendered height — a
   * branch folding into its collapsed chip, and the whole table tucking away
   * once the tree is done — into one height transition instead of a jump.
   *
   * MEASURE THE CONTENT, NEVER THE ANIMATION. This used to read
   * `el.scrollHeight` while a previous run's inline `height` and
   * `overflow: hidden` were still on the element, so it measured its own
   * animation mid-flight instead of the content underneath it. The effect has
   * no dependency array — it runs on every commit, including hovers — so any
   * commit landing inside the ~1s window fed the animation's current height
   * back in as the new target.
   *
   * On the guacamole demo that produced, measured at 390px: the tuck tap read
   * a target of 474px for a 60px chip, skipped the transition entirely because
   * target === start, left the stale inline height on, and then teleported the
   * finish strip 414px when the 1400ms fallback timer wiped it. The two taps
   * after it inflated the container back to 474px around that same 60px chip,
   * held it for 1.4s, and snapped back — the "expand and contract while you
   * are pressing the buttons" this is here to prevent.
   *
   * So: clear the inline styles *before* measuring, and animate from wherever
   * the element visually is right now rather than from a remembered number.
   * Interrupting a run mid-flight is then seamless — the new animation simply
   * starts from the current position — and no stale height can survive into
   * the next measurement.
   */
  const swapRef = useRef<HTMLDivElement>(null);
  const heightCleanupRef = useRef<(() => void) | null>(null);
  const hasMeasuredRef = useRef(false);
  /** Last commit's *content* height — the start of the next animation
   *  whenever one is not already in flight. Only ever assigned the value of
   *  scrollHeight read with the inline styles cleared, so an animation can
   *  never be fed back into it. */
  const prevHeightRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = swapRef.current;
    if (!el) return;

    // Where to animate from depends on whether a run is already going.
    //
    // This effect is a layout effect, so by the time it runs React has already
    // committed the new DOM and the browser has already laid it out. If
    // nothing is pinning the element, its measured height is therefore the
    // height we are trying to animate *to* — reading it here and calling it
    // the start would animate from the target to the target, i.e. not at all.
    // So the start is the previous commit's content height, remembered.
    //
    // If a run *is* in flight the element is pinned by an inline height, and
    // that pinned value is exactly where it is on screen right now — which
    // makes it the honest start, and lets an interrupted run continue from
    // where it visually got to instead of snapping.
    const wasAnimating = el.style.height !== "";
    const pinnedHeight = wasAnimating ? el.getBoundingClientRect().height : null;

    // Drop any in-flight run and its inline styles before measuring, so
    // scrollHeight reports the content rather than the animation.
    heightCleanupRef.current?.();
    heightCleanupRef.current = null;
    el.style.transition = el.style.height = el.style.overflow = "";
    const targetHeight = el.scrollHeight;

    const startHeight = pinnedHeight ?? prevHeightRef.current;
    prevHeightRef.current = targetHeight;

    // First commit has nothing to animate from.
    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      return;
    }
    if (startHeight == null || Math.abs(startHeight - targetHeight) < 0.5) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    el.style.height = `${startHeight}px`;
    el.style.overflow = "hidden";
    // Force layout so the browser registers the start height before the
    // target height is applied, or there is nothing to transition from.
    void el.getBoundingClientRect();
    el.style.transition = `height ${SWAP_MS}ms cubic-bezier(.2,.7,.3,1)`;
    el.style.height = `${targetHeight}px`;

    const clear = () => {
      el.style.transition = el.style.height = el.style.overflow = "";
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.propertyName !== "height") return;
      clear();
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timeout);
      heightCleanupRef.current = null;
    };
    // transitionend is not guaranteed: a hidden or backgrounded element never
    // fires it, and neither does a transition the engine declines to run.
    // Without a fallback the inline height and overflow:hidden stay on
    // forever, which reads as the card clipping its own diagram — the bug this
    // belt-and-braces timer exists to prevent, not to mask.
    const timeout = window.setTimeout(clearAndDetach, SWAP_MS + 400);
    function clearAndDetach() {
      clear();
      el!.removeEventListener("transitionend", onEnd);
      heightCleanupRef.current = null;
    }
    el.addEventListener("transitionend", onEnd);
    heightCleanupRef.current = () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timeout);
    };
  });

  let baseLayout;
  try {
    baseLayout = computeLayout(section);
  } catch (e) {
    return (
      <section className="rd-section">
        <p className="rd-eyebrow">{section.name}</p>
        <p className="rd-error">{(e as Error).message}</p>
      </section>
    );
  }
  const baseTotalRows = baseLayout.totalRows;

  // ---- terminal chain ----------------------------------------------------
  // Walk down from the root while each step spans every row. A step spanning
  // everything is combining the whole dish, so it has no structure left to show.
  // But the step where the *last* ingredient actually joins is the join itself,
  // not a consequence of it — it stays in the table even though it also spans
  // every row, so the table always shows where every ingredient lands.
  // This always walks the uncollapsed layout, so the finish strip is entirely
  // unaffected by progressive collapse below.
  const nodeById = new Map(section.nodes.map((n) => [n.id, n]));
  const spanById = new Map<string, number>();
  baseLayout.rows.forEach((r) =>
    r.forEach((c) => {
      if (c.kind === "op") spanById.set(c.key, c.rowSpan);
    })
  );

  const tail: Step[] = [];
  let cursor: string | undefined = section.root;
  while (cursor && spanById.get(cursor) === baseTotalRows) {
    const node = nodeById.get(cursor);
    if (!node) break;
    const stepInputs = node.inputs || [];
    const joinsIngredient = stepInputs.some((i) => !nodeById.has(i));
    if (joinsIngredient) break;
    tail.unshift(node);
    const priorSteps = stepInputs.filter((i) => nodeById.has(i));
    cursor = priorSteps.length === 1 ? priorSteps[0] : undefined;
  }
  const tailIds = new Set(tail.map((n) => n.id));

  // ---- progressive collapse -----------------------------------------------
  // A finished step folds its whole subtree into one row once its parent
  // isn't finished too (or it has no parent at all) — everything upstream of
  // it is already done, so there is nothing left to decide in that branch.
  // Tail steps are the finish strip's job, never the table's, so they're
  // never eligible here regardless of done state.
  //
  // Steps only collapse alongside their fellow inputs of the same parent
  // step, not one at a time — a parent's rowspan is the union of its
  // inputs' rows, so folding one input away while a sibling input stays
  // multi-row reads as broken alignment rather than progress. Grouping by
  // shared parent (rather than by column) matters because layout now packs
  // steps as-late-as-possible: an unrelated, short branch elsewhere in the
  // tree can land in the same column as this step's real siblings purely by
  // numeric coincidence, without actually feeding the same parent.
  const siblingsByParent = new Map<string, string[]>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    const parent = baseLayout.parentOf.get(node.id);
    if (parent == null) continue;
    if (!siblingsByParent.has(parent)) siblingsByParent.set(parent, []);
    siblingsByParent.get(parent)!.push(node.id);
  }
  const siblingGroupFullyDone = (parent: string) =>
    (siblingsByParent.get(parent) || []).every((id) => done.has(id));

  const collapsedIds = new Set<string>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    if (!done.has(node.id)) continue;
    if (expanded.has(node.id)) continue;
    const parent = baseLayout.parentOf.get(node.id);
    if (parent && done.has(parent)) continue;
    if (parent && !siblingGroupFullyDone(parent)) continue;
    collapsedIds.add(node.id);
  }

  let rows = baseLayout.rows;
  if (collapsedIds.size) {
    try {
      rows = computeLayout(section, { collapsed: collapsedIds }).rows;
    } catch {
      // Fall back to the uncollapsed layout rather than breaking the diagram.
    }
  }

  // ---- handoff -----------------------------------------------------------
  const treeIds = [
    ...section.ingredients.map((i) => i.id),
    ...section.nodes.filter((n) => !tailIds.has(n.id)).map((n) => n.id),
  ];
  const treeDone = treeIds.length > 0 && treeIds.every((id) => done.has(id));
  // The override only applies once the tree is finished, so unchecking anything
  // brings the diagram straight back with no stale state to reset.
  const showTable = treeDone ? override : true;

  /**
   * The one place a cell's behaviour is decided, which is why edit mode hooks
   * in here rather than anywhere else. In edit mode a tap opens fields and
   * never toggles `done` — someone who wanders in and taps around must not
   * quietly complete their recipe, and `aria-pressed` goes with it, because
   * the control is no longer a toggle.
   */
  const interaction = (
    key: string,
    label: string,
    ready: boolean,
    isDone: boolean,
    kind: "ingredient" | "op"
  ) => {
    const hover = {
      onMouseEnter: () => onHover(key),
      onMouseLeave: () => onHover(null),
      onFocus: () => onHover(key),
      onBlur: () => onHover(null),
    };

    if (edit?.active) {
      return {
        role: "button" as const,
        tabIndex: 0,
        title:
          kind === "ingredient"
            ? `Edit ${label}, or press and hold to move it`
            : `Edit “${label}”`,
        onClick: () => edit.onTapCell(key),
        onPointerDown:
          kind === "ingredient"
            ? (e: React.PointerEvent) => edit.onPointerDown(e, key)
            : undefined,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            edit.onTapCell(key);
          }
        },
        ...hover,
      };
    }

    return {
      role: "button" as const,
      tabIndex: 0,
      "aria-pressed": isDone,
      title: isDone
        ? `Undo ${label} and everything after it`
        : ready
          ? `Mark ${label} done`
          : `Mark ${label} done, along with every step before it`,
      onClick: () => onToggle(key),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(key);
        }
      },
      ...hover,
    };
  };

  const headContent = (
    <>
      <p className="rd-eyebrow">
        <span className="rd-eyebrow-num">{String(index + 1).padStart(2, "0")}</span>
        {section.name}
      </p>
      {section.header ? <p className="rd-oven">{section.header}</p> : null}
    </>
  );

  return (
    <section className="rd-section">
      {/* In edit mode the section's title becomes the way to edit the section
          — the same tap-the-thing rule the cells follow. It is a 15px-tall
          line the rest of the time, so the edit-mode variant grows to a 44px
          target rather than relying on a 15px one being hittable. */}
      {edit?.active ? (
        <button
          type="button"
          className="rd-section-head is-editable"
          onClick={edit.onTapSection}
          title="Rename this section, or delete it"
        >
          {headContent}
        </button>
      ) : (
        <div className="rd-section-head">{headContent}</div>
      )}

      {showTable ? (
        <div className="rd-swap" ref={swapRef}>
          <div className="rd-frame">
            <table className="rd-table">
              <tbody>
                {rows.map((cellsInRow, r) => (
                  // Keyed by the row's own leading (ingredient) cell, not by
                  // index — a stable key so rows below a collapse point don't
                  // all appear to change identity (and refade) just because
                  // their index shifted when rows above them disappeared.
                  <tr key={cellsInRow[0]?.key ?? r}>
                    {cellsInRow
                      .filter((c) => !tailIds.has(c.key))
                      .map((c) => {
                        if (c.kind === "collapsed") {
                          return (
                            <td
                              key={c.key}
                              className={[
                                "rd-cell",
                                "rd-ing",
                                "rd-collapsed",
                                c.startsBranch ? "rd-starts-branch" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              rowSpan={c.rowSpan}
                              colSpan={c.colSpan}
                            >
                              <button
                                type="button"
                                className="rd-collapsed-chip rd-row-swap"
                                onClick={() =>
                                  setExpanded((prev) => {
                                    const next = new Set(prev);
                                    next.add(c.key);
                                    return next;
                                  })
                                }
                                aria-label={`Expand "${c.text}" to show its ${c.itemCount} ingredients and steps`}
                              >
                                <span className="rd-tucked-check" aria-hidden="true" />
                                <span className="rd-collapsed-text">{c.text}</span>
                              </button>
                            </td>
                          );
                        }

                        if (c.kind === "gap") {
                          const ownerDone = done.has(c.owner!);
                          const ownerPrev = !ownerDone && preview.has(c.owner!);
                          return (
                            <td
                              key={c.key}
                              className={[
                                "rd-gap",
                                ownerDone ? "is-done" : "",
                                ownerPrev ? "is-preview" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              style={
                                ownerDone || ownerPrev
                                  ? undefined
                                  : { background: depthTint(c.depth!) }
                              }
                              rowSpan={c.rowSpan}
                              colSpan={c.colSpan}
                            />
                          );
                        }

                        const isDone = done.has(c.key);
                        const ready =
                          c.kind === "ingredient" ||
                          (c.inputs || []).every((i) => done.has(i));
                        const pending = !isDone && !ready;
                        const isPreview = !isDone && preview.has(c.key);
                        const neutral = !isDone && !ready && !isPreview;
                        const label =
                          c.kind === "ingredient" ? c.ingredient!.name : c.text!;

                        const editing = !!edit?.active;
                        const isStep = c.kind === "op";
                        // `data-step-id` is what the drag hit-tests against
                        // via elementFromPoint, so it has to be on the cell
                        // itself rather than an inner span.
                        return (
                          <td
                            key={c.key}
                            data-step-id={editing && isStep ? c.key : undefined}
                            data-ing-id={editing && !isStep ? c.key : undefined}
                            className={[
                              "rd-cell",
                              "rd-row-swap",
                              c.kind === "ingredient" ? "rd-ing" : "rd-op",
                              isDone ? "is-done" : "",
                              !isDone && ready ? "is-ready" : "",
                              pending ? "is-pending" : "",
                              isPreview ? "is-preview" : "",
                              c.startsBranch ? "rd-starts-branch" : "",
                              editing ? "is-editable" : "",
                              editing && edit!.pressing === c.key ? "is-pressing" : "",
                              editing && edit!.dragging === c.key ? "is-lifted" : "",
                              editing && isStep && edit!.dragging && edit!.validTargets.has(c.key)
                                ? "is-drop-ok"
                                : "",
                              editing && isStep && edit!.hoverTarget === c.key ? "is-drop-over" : "",
                              editing && edit!.dragging && isStep && !edit!.validTargets.has(c.key)
                                ? "is-drop-no"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={
                              neutral && c.kind === "op"
                                ? { background: depthTint(c.depth!) }
                                : undefined
                            }
                            rowSpan={c.rowSpan}
                            colSpan={c.colSpan}
                            {...interaction(c.key, label, ready, isDone, c.kind as "ingredient" | "op")}
                          >
                            <span className="rd-mark" aria-hidden="true" />
                            {c.kind === "ingredient" ? (
                              <span className="rd-ing-body">
                                <span className="rd-amount">
                                  {formatAmount(c.ingredient!, scale)}
                                </span>
                                <span className="rd-name">
                                  {c.ingredient!.name}
                                  {c.ingredient!.note ? (
                                    <em className="rd-note">
                                      , {c.ingredient!.note}
                                    </em>
                                  ) : null}
                                </span>
                              </span>
                            ) : (
                              <span className="rd-op-label">{c.text}</span>
                            )}
                          </td>
                        );
                      })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rd-under">
            <p className="rd-swipe">Swipe sideways — ingredients stay pinned</p>
            {treeDone ? (
              <button className="rd-tuck-btn" onClick={() => setOverride(false)}>
                Tuck the diagram away
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rd-swap" ref={swapRef}>
          <button
            className="rd-tucked"
            onClick={() => setOverride(true)}
            title="Show the full diagram again"
          >
            <span className="rd-tucked-check" aria-hidden="true" />
            <span className="rd-tucked-text">
              All {section.ingredients.length} ingredients combined
            </span>
            <span className="rd-tucked-more">Show diagram</span>
          </button>
        </div>
      )}

      {tail.length ? (
        <ol className={`rd-finish ${treeDone ? "is-focus" : ""}`}>
          {tail.map((n, i) => {
            const isDone = done.has(n.id);
            const ready = (n.inputs || []).every((x) => done.has(x));
            const isPreview = !isDone && preview.has(n.id);
            return (
              <li key={n.id} className="rd-fin-item">
                {/* The tail is steps like any other, so it edits and accepts
                    drops like any other. Leaving it out would make "bake" the
                    one step in the recipe you cannot fix. */}
                <div
                  data-step-id={edit?.active ? n.id : undefined}
                  className={[
                    "rd-fin",
                    isDone ? "is-done" : "",
                    !isDone && ready ? "is-ready" : "",
                    isPreview ? "is-preview" : "",
                    edit?.active ? "is-editable" : "",
                    edit?.active && edit.dragging && edit.validTargets.has(n.id) ? "is-drop-ok" : "",
                    edit?.active && edit.hoverTarget === n.id ? "is-drop-over" : "",
                    edit?.active && edit.dragging && !edit.validTargets.has(n.id) ? "is-drop-no" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...interaction(n.id, n.label, ready, isDone, "op")}
                >
                  <span className="rd-fin-mark" aria-hidden="true" />
                  <span className="rd-fin-num">{i + 1}</span>
                  <span className="rd-fin-label">{n.label}</span>
                  {formatMinutes(n.minutes) ? (
                    <span className="rd-fin-time">{formatMinutes(n.minutes)}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
