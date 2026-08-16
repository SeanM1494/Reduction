/**
 * shared/schema.ts — Drizzle schema for persisted recipes.
 *
 * Two tables:
 *   recipes           — the saved library, scoped by owner_key (see
 *                        server/routes/library.ts for the ownership model).
 *   extraction_cache   — durable replacement for the in-memory Map cache
 *                        that used to live in server/routes/recipes.ts.
 */

import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import type { Recipe } from "./layout";

export const recipes = pgTable(
  "recipes",
  {
    // Client-generated, e.g. crypto.randomUUID(). id alone is NOT globally
    // unique across owners, so the key is (owner_key, id) together — see
    // server/cleanupSeed.ts for why a literal id of "seed" is still
    // special-cased even though nothing creates one anymore.
    id: text("id").notNull(),
    ownerKey: text("owner_key").notNull(),
    recipe: jsonb("recipe").$type<Recipe>().notNull(),
    done: jsonb("done").$type<string[]>().notNull().default([]),
    servings: integer("servings"),
    /** Which view the recipe was last shown in — remembered per recipe. */
    mode: text("mode").notNull().default("diagram"),
    /** Active cooking-mode timer, if any: an absolute end time (epoch ms),
     *  never a countdown — see client/src/components/StepsMode.tsx. */
    timer: jsonb("timer").$type<{ stepId: string; endsAt: number } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKey, table.id] }),
    index("recipes_owner_updated_idx").on(table.ownerKey, table.updatedAt),
  ]
);

export const extractionCache = pgTable("extraction_cache", {
  hash: text("hash").primaryKey(),
  recipe: jsonb("recipe").$type<Recipe>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
