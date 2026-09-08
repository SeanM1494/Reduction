/**
 * @workspace/recipe-model — THE recipe model, in exactly one place.
 *
 * layout (the tree + computeLayout + validateRecipe), sequence (the
 * cooking-order invariant), edits (the visual editor's pure operations),
 * sync (the three-way merge), amounts (scaling + unit-aware rounding),
 * mealTypes and progress. The Sep 8 workspace migration copied these into
 * every artifact — four copies with nothing keeping them identical, which is
 * the drift this package exists to make impossible again. The per-artifact
 * `src/shared/` files still exist as one-line re-exports of this package, so
 * import sites did not have to churn; the LOGIC lives only here.
 *
 * NO runtime dependencies and NO env access, deliberately: @workspace/db
 * throws at import when DATABASE_URL is unset, which is precisely why the
 * frontend could not import it and the copies happened. This package must
 *  stay importable from a browser bundle, a native bundle, and a test file
 * with zero setup, forever.
 *
 * Its test suites live beside the sources here — they are the only guard on
 * invariants nothing downstream catches (the cooking-order property tests,
 * the 324-row scale-1 identity table, merge-resurrection cases).
 */
export * from "./layout";
export * from "./sequence";
export * from "./edits";
export * from "./sync";
export * from "./amounts";
export * from "./mealTypes";
export * from "./progress";
