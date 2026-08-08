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

import React, { useState } from "react";
import { computeLayout, type Section, type Step } from "../../../shared/layout";
import { formatAmount } from "../../../shared/amounts";

/**
 * Columns shade deeper to the right, so stage depth reads before interaction.
 * Mixed from the theme's own card/ink tokens (not a fixed hue) so the same
 * progression works unmodified in light, dark and colorblind mode.
 */
const depthTint = (d: number) => {
  const pct = Math.min(d, 12) * 1.1;
  return `color-mix(in srgb, var(--card) ${100 - pct}%, var(--ink) ${pct}%)`;
};

function fmtTime(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

interface Props {
  section: Section;
  index: number;
  done: Set<string>;
  preview: Set<string>;
  scale: number;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
}

export default function Diagram({
  section,
  index,
  done,
  preview,
  scale,
  onToggle,
  onHover,
}: Props) {
  const [override, setOverride] = useState(false);
  // Ids the user has manually reopened after they qualified for collapse.
  // Once reopened they stay open for the life of this component — unchecking
  // a step inside a collapsed branch also reopens it, since that step's
  // parent chain (the collapsed step itself) gets un-done by the same click.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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
  // Steps only collapse alongside their whole column, not one at a time —
  // columns share a depth/stage in the diagram's shading, so folding one
  // step to column 0 while a sibling stays at its column reads as broken
  // alignment rather than progress. A column is "done" once every step
  // drawn at that depth is checked off.
  const colOfNode = new Map<string, number>();
  baseLayout.rows.forEach((r) =>
    r.forEach((c) => {
      if (c.kind === "op") colOfNode.set(c.key, c.depth!);
    })
  );
  const stepsByColumn = new Map<number, string[]>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    const col = colOfNode.get(node.id);
    if (col == null) continue;
    if (!stepsByColumn.has(col)) stepsByColumn.set(col, []);
    stepsByColumn.get(col)!.push(node.id);
  }
  const columnFullyDone = (col: number) =>
    (stepsByColumn.get(col) || []).every((id) => done.has(id));

  const collapsedIds = new Set<string>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    if (!done.has(node.id)) continue;
    if (expanded.has(node.id)) continue;
    const parent = baseLayout.parentOf.get(node.id);
    if (parent && done.has(parent)) continue;
    const col = colOfNode.get(node.id);
    if (col != null && !columnFullyDone(col)) continue;
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

  const interaction = (
    key: string,
    label: string,
    ready: boolean,
    isDone: boolean
  ) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": isDone,
    title: isDone
      ? `Undo ${label} and everything after it`
      : ready
        ? `Mark ${label} done`
        : `Mark ${label} done, along with every step before it`,
    onClick: () => onToggle(key),
    onMouseEnter: () => onHover(key),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(key),
    onBlur: () => onHover(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle(key);
      }
    },
  });

  return (
    <section className="rd-section">
      <div className="rd-section-head">
        <p className="rd-eyebrow">
          <span className="rd-eyebrow-num">
            {String(index + 1).padStart(2, "0")}
          </span>
          {section.name}
        </p>
        {section.header ? <p className="rd-oven">{section.header}</p> : null}
      </div>

      {showTable ? (
        <div className="rd-swap">
          <div className="rd-frame">
            <table className="rd-table">
              <tbody>
                {rows.map((cellsInRow, r) => (
                  <tr key={r}>
                    {cellsInRow
                      .filter((c) => !tailIds.has(c.key))
                      .map((c) => {
                        if (c.kind === "collapsed") {
                          return (
                            <td
                              key={c.key}
                              className="rd-cell rd-ing rd-collapsed"
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
                                <span className="rd-collapsed-count">
                                  {c.itemCount} items
                                </span>
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

                        return (
                          <td
                            key={c.key}
                            className={[
                              "rd-cell",
                              "rd-row-swap",
                              c.kind === "ingredient" ? "rd-ing" : "rd-op",
                              isDone ? "is-done" : "",
                              !isDone && ready ? "is-ready" : "",
                              pending ? "is-pending" : "",
                              isPreview ? "is-preview" : "",
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
                            {...interaction(c.key, label, ready, isDone)}
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
        <div className="rd-swap">
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
                <div
                  className={[
                    "rd-fin",
                    isDone ? "is-done" : "",
                    !isDone && ready ? "is-ready" : "",
                    isPreview ? "is-preview" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...interaction(n.id, n.label, ready, isDone)}
                >
                  <span className="rd-fin-mark" aria-hidden="true" />
                  <span className="rd-fin-num">{i + 1}</span>
                  <span className="rd-fin-label">{n.label}</span>
                  {n.minutes ? (
                    <span className="rd-fin-time">{fmtTime(n.minutes)}</span>
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
