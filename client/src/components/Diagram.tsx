/**
 * client/src/components/Diagram.tsx — one section as one table.
 *
 * Cell states are derived, never stored: a step is ready when all its inputs
 * are done, pending otherwise. The tree already knows what is actionable, so
 * this only has to draw it.
 */

import React from "react";
import { computeLayout, type Section } from "../../../shared/layout";
import { formatAmount } from "../../../shared/amounts";

/** Columns shade deeper to the right, so stage depth reads before interaction. */
const depthTint = (d: number) => `hsl(34 34% ${97.2 - Math.min(d, 12) * 0.95}%)`;

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
  let rows;
  try {
    rows = computeLayout(section).rows;
  } catch (e) {
    return (
      <section className="rd-section">
        <p className="rd-eyebrow">{section.name}</p>
        <p className="rd-error">{(e as Error).message}</p>
      </section>
    );
  }

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

      <div className="rd-frame">
        <table className="rd-table">
          <tbody>
            {rows.map((cellsInRow, r) => (
              <tr key={r}>
                {cellsInRow.map((c) => {
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
                      role="button"
                      tabIndex={0}
                      aria-pressed={isDone}
                      title={
                        isDone
                          ? `Undo ${label} and everything after it`
                          : pending
                            ? `Mark ${label} done, along with every step before it`
                            : `Mark ${label} done`
                      }
                      onClick={() => onToggle(c.key)}
                      onMouseEnter={() => onHover(c.key)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(c.key)}
                      onBlur={() => onHover(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onToggle(c.key);
                        }
                      }}
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
                              <em className="rd-note">, {c.ingredient!.note}</em>
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
      <p className="rd-swipe">Swipe sideways — ingredients stay pinned</p>
    </section>
  );
}
