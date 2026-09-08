---
name: Progressive-collapse sibling grouping must use parent, not column
description: Why the diagram's "fold a finished branch into one row" feature groups steps by shared immediate parent, not by shared layout column.
---

`Diagram.tsx`'s progressive-collapse feature (a finished step folds its
subtree into one row) must gate collapse on whether a step's *true siblings*
— the other step-inputs of its own immediate consumer (`baseLayout.parentOf`)
— are also done, not on whether everything sharing its numeric layout column
is done.

**Why:** `shared/layout.ts` assigns columns "as-late-as-possible" (a step's
column is its consumer's column minus one, via a top-down `place()` walk).
This packs a short branch tight against its merge point, but it means two
completely unrelated branches elsewhere in the tree can land on the same
column number by pure numeric coincidence — they are not feeding the same
merge step. Grouping collapse-eligibility by column caused real bugs: a
finished branch would refuse to collapse until an unrelated, unfinished
branch happened to also finish (false block), and finishing that unrelated
branch later would suddenly collapse two unconnected steps at once (looked
like random/spontaneous collapsing to the user). True merge-siblings (direct
step-inputs of one parent) are *always* assigned the same column by
construction, so grouping by shared parent is strictly correct and a subset
of the old column-based grouping — it fixes the coincidental-collision cases
with no loss for the legitimate case.

**How to apply:** any future collapse/grouping/alignment logic in this
diagram must key off `baseLayout.parentOf` (or equivalent direct-consumer
relationships) rather than off column/depth numbers, since column numbers in
this layout are a spatial-packing artifact, not a stable proxy for "same
branch stage" once the late-as-possible pass is in play.
