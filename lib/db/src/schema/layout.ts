// The recipe model lives in @workspace/recipe-model — this file exists only
// so schema.ts can type its jsonb columns without lib/db owning a copy of
// the 440-line model. Do not add logic here.
export * from "@workspace/recipe-model/layout";
