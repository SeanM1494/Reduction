---
name: Step-by-step cooking mode card sequence
description: How the linear "cook through it" card view derives its order and states from the existing tree layout, without touching layout.ts.
---

Deriving a linear step sequence from a tree layout (computeLayout in shared/layout.ts) without modifying it: call the unmodified `computeLayout(section)`, flatten `layout.rows`, filter to `kind === "op"` cells, and sort by `(row, col)` ascending. Because DFS assigns leaf rows in traversal order and a step's row is its first (lowest) leaf row, this reproduces the tree's depth-first order — including cases where several ancestors along the same leftmost spine all share row 0, which sorting by column resolves correctly (deepest/leaf-most step first).

**Why:** The spec required "card order = depth-first, same order as the diagram's rows" while explicitly forbidding changes to layout.ts/Diagram.tsx. Reusing computeLayout's own output (rather than re-deriving traversal order separately) guarantees the two views can never disagree.

**How to apply:** Any future linear/alternate view of the same tree data (e.g. a print view, a shopping-list order) should derive order the same way — flatten+sort `rows`, don't hand-roll a new DFS.

Separate lesson: sections in this app are independent trees (no cross-section id references), so "only suggest work from other sections" is sufficient to guarantee "never downstream of the current step" — no extra ancestor-check needed.

Timers persist as an absolute `{stepId, endsAt}` epoch-ms pair (a `timer` jsonb column on the recipe row), never a running countdown — the countdown UI is `endsAt - Date.now()` recomputed on a 1s re-render tick. This is the same pattern used elsewhere for "must survive a full app close" state; prefer it over setInterval-driven state whenever a duration must survive a reload/close.
