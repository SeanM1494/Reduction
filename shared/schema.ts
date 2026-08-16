/**
 * shared/schema.ts — Drizzle schema.
 *
 *   recipes           — the saved library. Owned by a user once signed in,
 *                        by an anonymous owner_key before that (see
 *                        server/routes/library.ts for the ownership model).
 *   extraction_cache   — durable replacement for the in-memory Map cache
 *                        that used to live in server/routes/recipes.ts.
 *   users, identities  — accounts. One user, many provider identities.
 *   sessions           — server-side sessions behind the rd_session cookie.
 *   auth_states        — in-flight OAuth handshakes, single-use.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
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
    /**
     * Set once the row belongs to an account. owner_key is kept alongside it
     * rather than overwritten — it records which browser originally saved the
     * recipe, and keeps the (owner_key, id) primary key working untouched
     * through the migration.
     *
     * Null means the row is still anonymous. Every library query scopes by
     * exactly one of the two: user_id when there is a session, owner_key AND
     * user_id IS NULL when there is not.
     */
    userId: text("user_id"),
    /**
     * 'private' | 'public'. Nothing reads this yet and no UI sets it — the
     * column exists so turning sharing on later is not a migration against a
     * live user base. Default private: the only safe direction to be wrong in.
     */
    visibility: text("visibility").notNull().default("private"),
    /** Reserved for share links. Unused until sharing ships. */
    shareSlug: text("share_slug"),
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
    index("recipes_user_updated_idx").on(table.userId, table.updatedAt),
    /**
     * Two anonymous libraries merged into one account can each carry the same
     * recipe id under different owner_keys — ids were `r${Date.now()}` until
     * recently, so same-millisecond saves on two devices genuinely collide.
     * Within an account that would make PATCH/DELETE by id ambiguous, so the
     * merge re-keys colliding rows. This index is what makes that a guarantee
     * rather than a thing the merge function remembers to do.
     */
    uniqueIndex("recipes_user_id_unique")
      .on(table.userId, table.id)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("recipes_share_slug_unique")
      .on(table.shareSlug)
      .where(sql`${table.shareSlug} is not null`),
  ]
);

export const extractionCache = pgTable("extraction_cache", {
  hash: text("hash").primaryKey(),
  recipe: jsonb("recipe").$type<Recipe>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------- accounts --

/** One human. Providers hang off this, not the other way round. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  /**
   * Best-known email, for display only. Never used to find or link an
   * account — see identities below.
   */
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * A provider login. `subject` is the provider's own stable user id (`sub`).
 *
 * There is deliberately NO unique constraint on email, and nothing looks an
 * account up by email: Sign in with Apple can hand back a
 * @privaterelay.appleid.com address, and linking two identities because their
 * email strings match would make an unverified address an account-takeover
 * path. Connecting a second provider to an existing account is an explicit,
 * signed-in action, whenever it ships.
 */
export const identities = pgTable(
  "identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    index("identities_user_idx").on(table.userId),
  ]
);

/**
 * Server-side sessions, behind an httpOnly cookie.
 *
 * The row is keyed by the SHA-256 of the session token, never the token
 * itself, so a dump of this table does not hand over live sessions. Expiry is
 * enforced on read as well as by the sweep in server/lib/sessions.ts — a row
 * that outlives its expires_at is never honoured, whether or not the sweep
 * has got to it.
 */
export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ]
);

/**
 * One in-flight OAuth handshake. Holds the CSRF `state`, the PKCE verifier,
 * and the pending recipe URL a visitor submitted before signing up.
 *
 * Carrying the pending URL here rather than in sessionStorage is what lets it
 * survive a provider that lands in a new tab, or a sign-up finished on a
 * different device. Rows are strictly single-use: the callback deletes the
 * row in the same statement that reads it, so a replayed state finds nothing
 * and cannot re-trigger an extraction. Expiry is checked on read and swept.
 */
export const authStates = pgTable(
  "auth_states",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    pkceVerifier: text("pkce_verifier"),
    pendingUrl: text("pending_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_states_expires_idx").on(table.expiresAt)]
);
