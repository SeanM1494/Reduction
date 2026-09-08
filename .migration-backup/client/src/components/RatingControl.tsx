/**
 * client/src/components/RatingControl.tsx — the reported half of the signal.
 *
 * THREE STATES, NOT FIVE. Repeat cooks already outrank opinion in the
 * ranking hierarchy (ROADMAP #8): the strongest evidence a recipe is good is
 * that someone made it three times, which the app observes without asking.
 * A five-point scale would add resolution to the weaker input — precision
 * where the signal is noisiest — so the rating only has to be coarse enough
 * to separate "make again" from "never again".
 *
 * ONE RATING PER RECIPE, NOT PER COOK. It is a standing verdict on the
 * recipe, and it is allowed to change: the fifth cook can promote what the
 * first one merely tolerated. The per-cook history is what `cooked` already
 * records, and keeping the two separate is the whole point — cooked is
 * observed, rating is reported.
 *
 * HIDDEN UNTIL COOKED ONCE. Asking someone to rate a recipe they have not
 * made yet collects an opinion about a web page, not about dinner. It also
 * keeps the control off the screen at the moment it would be pure noise.
 */

import React from "react";

export const RATING_DOWN = -1;
export const RATING_OK = 0;
export const RATING_UP = 1;

interface Props {
  rating: number | null | undefined;
  onChange: (rating: number | null) => void;
}

const OPTIONS: Array<{ value: number; glyph: string; label: string }> = [
  { value: RATING_DOWN, glyph: "\u{1F44E}", label: "Would not make again" },
  { value: RATING_OK, glyph: "\u{1F44C}", label: "Fine" },
  { value: RATING_UP, glyph: "\u{1F44D}", label: "Favourite" },
];

export default function RatingControl({ rating, onChange }: Props) {
  const current = typeof rating === "number" ? rating : null;
  return (
    <div className="rfx-rating no-print" role="group" aria-label="Rate this recipe">
      {OPTIONS.map(({ value, glyph, label }) => {
        const on = current === value;
        return (
          <button
            key={value}
            className={`rfx-rating-btn ${on ? "is-on" : ""}`}
            aria-pressed={on}
            aria-label={label}
            title={on ? `${label} — tap to clear` : label}
            // Tapping the current rating clears it. A verdict you can set but
            // never unset is a trap, and there is no other affordance for
            // "actually, I have no opinion".
            onClick={() => onChange(on ? null : value)}
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
