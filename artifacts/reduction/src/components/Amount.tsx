/**
 * components/Amount.tsx — an ingredient amount with its fraction glyphs in
 * `.rd-frac`, drawn at 1.5em (shared/amounts.ts `fractionRuns`, and the
 * mobile AmountText for why: a vulgar fraction is one character cell, and
 * its digits come out at ~40% of the whole number beside them).
 */

import { fractionRuns } from "../shared/amounts";

export function Amount({ text }: { text: string }) {
  return (
    <>
      {fractionRuns(text).map((r, i) =>
        r.fraction ? (
          <span key={i} className="rd-frac">
            {r.text}
          </span>
        ) : (
          r.text
        )
      )}
    </>
  );
}
