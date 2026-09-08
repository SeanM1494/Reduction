/**
 * Minimal copy of the shapes StepsMode/RecipeView need from the real app's
 * client/src/lib/storage.ts. Only the type shapes are needed here — this
 * sandbox has no server, so the persistence functions are left out and each
 * mockup keeps its own state locally via useState.
 */
import type { Recipe } from "./layout";

/** Absolute end time (epoch ms), never a countdown — see StepsMode.tsx. */
export interface StepTimer {
  stepId: string;
  endsAt: number;
}

export interface Entry {
  id: string;
  recipe: Recipe;
  done: string[];
  servings: number | null;
  mode: "diagram" | "steps";
  timer: StepTimer | null;
  savedAt: number;
}
