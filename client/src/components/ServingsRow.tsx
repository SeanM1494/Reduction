/**
 * client/src/components/ServingsRow.tsx — how many you are making tonight,
 * and what the recipe says it makes.
 *
 * TWO NUMBERS THAT MUST NEVER SHARE A CONTROL
 *
 * `recipe.servings` is what the recipe makes. It is part of the tree, it is a
 * correction, and it is edited in the recipe sheet. `entry.servings` is what
 * you are cooking tonight, it is per-entry, and `scale` is the second divided
 * by the first — which is what every amount in the diagram is rendered
 * through. A single stepper wired to both would hold `scale` at exactly 1 for
 * ever: scaling would stop working, every amount would still look right, and
 * nothing anywhere would report it. THIS stepper writes `entry.servings` and
 * nothing else. See CLAUDE.md.
 *
 * Until this existed, `entry.servings` was plumbed end to end — storage, the
 * PATCH body, `scale`, `formatAmount` — with no control anywhere. Scaling was
 * a working feature nobody could reach.
 *
 * WHY yieldText AND THE MULTIPLIER ARE THE SAME SLOT
 *
 * `yieldText` is the source's own words for what the recipe makes: "makes 24
 * cookies", which is more use than a bare serving count. But it is a statement
 * about the UNSCALED recipe. At 2x it is simply false — the pan is not making
 * 24 cookies any more — so it cannot just sit there next to a scaled number.
 *
 * So the two never appear together. At scale 1 the recipe's own words; once
 * scaled, the multiplier, which is the thing that is actually true and the
 * thing you want to see when every amount on the page has just changed. That
 * also settles the crowding: it is one slot, not two.
 *
 * THE ONE DISAGREEMENT THIS DOES NOT RESOLVE, deliberately. Correcting
 * `recipe.servings` from 24 to 36 leaves a yieldText that still says "makes 24
 * cookies", and they now contradict each other. Nothing here can tell: yield
 * text is free prose — "makes 2 dozen", "one 9-inch pie", "serves 4-6" —
 * and deciding whether it agrees with a number is a parsing problem with a
 * wrong answer available. Clearing it on a servings edit would silently
 * destroy the source's own words on a guess. The mitigation is already in
 * place and is why Yield sits directly under Serves in the recipe sheet:
 * anyone correcting one is looking straight at the other.
 */

import { formatQty } from "../../../shared/amounts";

/** Sane for a recipe. The upper bound stops a long press running away, and
 *  the lower bound is 1 because zero servings scales everything to nothing. */
const MIN = 1;
const MAX = 999;

/**
 * How much one tap moves it, which cannot be 1.
 *
 * A serves-4 dinner steps 4 -> 5 -> 6 and 1 is exactly right. A 24-cookie
 * batch stepped by 1 is a control nobody can use: halving it takes twelve
 * taps, and one tap produces "25 cookies", a x1.04 multiplier and a set of
 * amounts no kitchen scale can tell apart from the original.
 *
 * So the step scales with the batch: eighths, rounded, floored at 1. A base of
 * 4 still steps by 1; 12 steps by 2 and halves in three taps; 24 steps by 3
 * and halves in four. The number on screen stays a real serving count rather
 * than becoming a percentage, which is what someone cooking is actually
 * thinking in.
 */
const stepFor = (base: number): number =>
  base <= 8 ? 1 : Math.max(1, Math.round(base / 8));

export default function ServingsRow({
  /** What the recipe makes. Null when the extraction did not find one. */
  base,
  /** What you are cooking tonight, or null to mean "same as the recipe". */
  entryServings,
  yieldText,
  onChange,
}: {
  base: number | null;
  entryServings: number | null;
  yieldText?: string | null;
  onChange: (servings: number | null) => void;
}) {
  const yieldLine = yieldText?.trim() || null;

  // No base means no ratio, so scaling is meaningless and a stepper would be
  // a control that does nothing. The recipe's own words are still worth
  // showing if it has any.
  if (typeof base !== "number" || base <= 0) {
    return yieldLine ? (
      <p className="rd-servings rd-servings-plain">{yieldLine}</p>
    ) : null;
  }

  const current = entryServings ?? base;
  const scale = current / base;
  const step = stepFor(base);
  const set = (n: number) => {
    const next = Math.min(MAX, Math.max(MIN, n));
    // Back to the recipe's own number stores null rather than the number, so
    // "unchanged" stays distinguishable from "deliberately set to the same",
    // and a later correction to recipe.servings still means what it should.
    onChange(next === base ? null : next);
  };

  return (
    <div className="rd-servings">
      <div className="rd-servings-set">
        <span className="rd-servings-label" id="rd-servings-label">
          Making
        </span>
        <div className="rd-stepper">
          <button
            className="rd-step-btn"
            onClick={() => set(current - step)}
            disabled={current <= MIN}
            aria-label={`${step} fewer`}
          >
            &minus;
          </button>
          <span
            className="rd-step-val"
            role="status"
            aria-live="polite"
            aria-labelledby="rd-servings-label"
          >
            {formatQty(current)}
          </span>
          <button
            className="rd-step-btn"
            onClick={() => set(current + step)}
            disabled={current >= MAX}
            aria-label={`${step} more`}
          >
            +
          </button>
        </div>
      </div>

      {/* One slot. The recipe's words while they are true, the multiplier once
          they are not — never both, and never a yield line that contradicts
          the amounts directly below it. */}
      <p className="rd-servings-note">
        {scale === 1 ? (
          yieldLine ?? `Recipe makes ${formatQty(base)}`
        ) : (
          <>
            <span className="rd-servings-scale">&times;{formatQty(scale)}</span>
            {" from a recipe for "}
            {formatQty(base)}
            <button className="rd-servings-reset" onClick={() => onChange(null)}>
              Reset
            </button>
          </>
        )}
      </p>
    </div>
  );
}
