/**
 * client/src/components/MealTypeSheet.tsx — editing a recipe's meal types.
 *
 * Recipe-level metadata, not a tree edit: reachable any time from the
 * overflow menu, not gated behind edit mode, and not an `applyEdit` op.
 *
 * Two rows on purpose. A single toggle row with "tap again for primary"
 * makes one gesture mean two things; a Primary radio row plus an "Also" row
 * of toggles keeps every tap unambiguous. Picking a new primary keeps the
 * old one as a secondary — demoting is rarely what "chili is mostly lunch
 * now" means — and untoggling the primary itself is done by picking another.
 */

import React from "react";
import {
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  sanitizeMealTypes,
  type MealType,
} from "../../../shared/mealTypes";

interface Props {
  mealTypes: string[] | undefined;
  onChange: (next: MealType[]) => void;
  onClose: () => void;
}

export default function MealTypeSheet({ mealTypes, onChange, onClose }: Props) {
  const current = sanitizeMealTypes(mealTypes);
  const primary = current[0] ?? null;
  const secondaries = new Set(current.slice(1));

  const setPrimary = (t: MealType) => {
    if (t === primary) return;
    const rest = current.filter((x) => x !== t);
    onChange([t, ...rest]);
  };

  const toggleSecondary = (t: MealType) => {
    if (t === primary) return; // the primary row owns this one
    if (secondaries.has(t)) onChange(current.filter((x) => x !== t));
    else onChange([...current, t]);
  };

  return (
    <div
      className="rd-sheet-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rd-sheet" role="dialog" aria-modal="true" aria-label="Meal types">
        <div className="rd-sheet-grab" aria-hidden="true" />
        <div className="rd-sheet-head">
          <h2 className="rd-sheet-title">Meal types</h2>
          <button className="rd-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="rd-field">
          <span className="rd-field-label">
            Primary <span className="rd-field-hint">drives sorting and the card badge</span>
          </span>
          <div className="rd-move-list" role="radiogroup" aria-label="Primary meal type">
            {MEAL_TYPES.map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={t === primary}
                className={`rd-move-opt ${t === primary ? "is-current" : ""}`}
                onClick={() => setPrimary(t)}
              >
                {MEAL_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="rd-field">
          <span className="rd-field-label">
            Also <span className="rd-field-hint">widens the filter matches</span>
          </span>
          <div className="rd-move-list">
            {MEAL_TYPES.map((t) => {
              const isPrimary = t === primary;
              const on = secondaries.has(t);
              return (
                <button
                  key={t}
                  aria-pressed={on}
                  disabled={isPrimary}
                  title={isPrimary ? "Already the primary" : undefined}
                  className={`rd-move-opt ${on ? "is-current" : ""}`}
                  onClick={() => toggleSecondary(t)}
                >
                  {MEAL_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        {current.length === 0 ? (
          <p className="rd-sheet-note">
            Untagged. Pick a primary and this recipe joins the meal-type filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
