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
} from "drizzle-orm/pg-core";
import type { Recipe } from "./layout";

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    recipe: jsonb("recipe").$type<Recipe>().notNull(),
    done: jsonb("done").$type<string[]>().notNull().default([]),
    servings: integer("servings"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("recipes_owner_updated_idx").on(table.ownerKey, table.updatedAt)]
);

export const extractionCache = pgTable("extraction_cache", {
  hash: text("hash").primaryKey(),
  recipe: jsonb("recipe").$type<Recipe>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
