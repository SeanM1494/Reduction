/**
 * client/src/components/RatingControl.tsx — the reported half of the signal,
 * as five whole stars.
 *
 * ONE RATING PER RECIPE, NOT PER COOK. It is a standing verdict on the
 * recipe, and it is allowed to change: the fifth cook can promote what the
 * first one merely tolerated. The per-cook history is what `cooked` already
 * records, and keeping the two separate is the point — cooked is observed,
 * rating is reported. Repeat cooks still outrank opinion where the app ranks
 * anything; stars are for the person's own sorting.
 *
 * WHOLE STARS: ten half-star targets across a phone are under 44px each.
 *
 * HIDDEN UNTIL COOKED ONCE. Asking someone to rate a recipe they have not
 * made yet collects an opinion about a web page, not about dinner.
 */

import React from "react";
import { STAR_WORDS, STARS_MAX } from "../shared/stars";

interface Props {
  /** The stars as shown (`starsOf`), or null. */
  stars: number | null | undefined;
  onChange: (stars: number | null) => void;
}

const VALUES = Array.from({ length: STARS_MAX }, (_, i) => i + 1);

export default function RatingControl({ stars, onChange }: Props) {
  const current = typeof stars === "number" ? stars : null;
  return (
    <div className="rfx-rating no-print" role="group" aria-label="Rate this recipe">
      {VALUES.map((value) => {
        const on = current === value;
        const filled = current !== null && value <= current;
        const label = `${value} ${value === 1 ? "star" : "stars"}, ${STAR_WORDS[value]}`;
        return (
          <button
            key={value}
            className={`rfx-rating-btn ${filled ? "is-on" : ""}`}
            aria-pressed={on}
            aria-label={label}
            title={on ? `${label} — tap to clear` : label}
            // Tapping the current rating clears it. A verdict you can set but
            // never unset is a trap, and there is no other affordance for
            // "actually, I have no opinion".
            onClick={() => onChange(on ? null : value)}
          >
            <span aria-hidden="true">★</span>
          </button>
        );
      })}
    </div>
  );
}
