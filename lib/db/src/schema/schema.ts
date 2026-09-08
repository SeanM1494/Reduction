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
  bigserial,
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
    /**
     * Optimistic-concurrency token, incremented by the server on every write.
     * A PATCH carrying `ifVersion` that no longer matches gets a 409 with the
     * current row, and the CLIENT merges — see shared/sync.ts for the model
     * and for why `done` merges by union. The server never merges: resolution
     * needs the recipe tree and knowledge of what the user just did, both of
     * which only the client has.
     */
    version: integer("version").notNull().default(1),
    /**
     * Epoch-ms timestamps of completed cook-throughs, appended when `done`
     * reaches the full count (ROADMAP #8). Observed rather than reported,
     * which is what makes it the more reliable of the two signals. Merged by
     * union with an hours-scale dedupe window.
     */
    cooked: jsonb("cooked").$type<number[]>().notNull().default([]),
    /**
     * The reported half: -1 (would not make again), 0 (fine), 1 (favourite),
     * or null for unrated. Deliberately coarse — repeat cooks already outrank
     * opinion in the ranking hierarchy, so a five-point scale would only add
     * resolution to the weaker input. One rating per recipe, not per cook: it
     * is a standing verdict, and the per-cook history is what `cooked`
     * already records.
     */
    rating: integer("rating"),
    /**
     * OrderPreference from shared/sequence.ts, or null. HOW THIS ENTRY wants
     * its step-by-step cards ordered where the tree leaves a choice — the
     * entry-level twin of the editor's `reorderInputs`, the same split as
     * `servings` (this column) vs `recipe.servings` (in the tree). Advisory:
     * the walk treats it as a tie-break and prunes what no longer exists, so
     * nothing here can violate the cooking-order invariant or break a read.
     */
    cardOrder: jsonb("card_order").$type<{
      sections?: string[];
      branches?: Record<string, string[]>;
    } | null>(),
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

export const extractionCache = pgTable(
  "extraction_cache",
  {
    /** sha256("url:" + the raw string). THE identity — unchanged since the
     *  cache was written, so every stored row stays addressable. */
    hash: text("hash").primaryKey(),
    /**
     * sha256("urlkey:" + the normalised string), or null for a row written
     * before this column existed and for anything that would not parse.
     *
     * An ALIAS, not a second identity: `cacheGet` tries `hash` first and only
     * then this, so dropping the alias lookup would be a one-line change with
     * nothing to migrate. See server/lib/urlKey.ts for why that matters —
     * it is what makes normalising safe to ship ahead of corrections
     * propagating between users.
     */
    urlKey: text("url_key"),
    recipe: jsonb("recipe").$type<Recipe>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("extraction_cache_url_key_idx").on(table.urlKey)]
);

/**
 * One row per extraction attempt or cache hit. OPERATIONAL, NOT BEHAVIOURAL.
 *
 * It exists to answer two questions before any cost tuning happens: what
 * fraction of extractions take the expensive `fetchViaClaude` path, and how
 * often the repair retry fires. Both were already on the wire as `meta.via`
 * and `meta.attempts` and nothing recorded them.
 *
 * TWO OMISSIONS THAT ARE THE POINT, not oversights:
 *
 *   - **No user id, and no trial id.** None of the questions this table
 *     answers need one. Adding one would turn an operations table into a
 *     record of what individual people read, with a retention policy and a
 *     deletion story attached, in exchange for nothing.
 *   - **Host, never the URL.** "Which sites force the expensive path" is the
 *     next question after the two above, and the host answers it. The path is
 *     what would make this a log of what somebody was cooking.
 *
 * Keep it that way. If you find yourself adding a column that identifies a
 * person, you are building a different table and it needs a different
 * conversation.
 */
export const extractionEvents = pgTable(
  "extraction_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** url | text | file | reextract */
    source: text("source").notNull(),
    /** True when this was served from extraction_cache: the denominator for
     *  the hit rate, and the rows that cost nothing. */
    cached: boolean("cached").notNull(),
    /** self | claude — null on a cache hit, because neither ran. */
    via: text("via"),
    /** 1, or 2 when the tree failed validateRecipe and was sent back. */
    attempts: integer("attempts"),
    /** How many validator errors triggered that retry. */
    repaired: integer("repaired"),
    /** Registrable-ish host, no path, no query. */
    host: text("host"),
    ok: boolean("ok").notNull(),
    ms: integer("ms"),
  },
  (table) => [index("extraction_events_at_idx").on(table.at)]
);

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
 * One browser's free extraction.
 *
 * THE RULE THIS DOES NOT BREAK. "No anonymous library" means many recipes,
 * indefinitely, for a browser that never signed in. It does not mean no
 * anonymous persistence: one recipe, pending signup, is the mechanism that
 * makes the funnel humane — a visitor looking at a diagram of a recipe they
 * chose is at the best possible moment to be asked for an account and the
 * worst possible moment to lose their work. This row is that one recipe. It
 * is not a library, and removing it to satisfy a rule it does not violate
 * would strand exactly the work the rule exists to protect.
 *
 * The recipe itself lives in `recipes` under owner_key `trial:<id>` with a
 * null user_id, so signing up is the same UPDATE the library claim performs
 * rather than a second way of owning a row.
 */
export const trials = pgTable("trials", {
  /** Random token, also the value of the httpOnly rd_trial cookie. */
  id: text("id").primaryKey(),
  /** The recipes row this trial produced, once it has been spent. */
  recipeId: text("recipe_id"),
  /** Null until the extraction is spent. Set atomically, so two requests
   *  racing the same cookie cannot both get a free extraction. */
  usedAt: timestamp("used_at", { withTimezone: true }),
  claimedByUserId: text("claimed_by_user_id"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
    /** The browser's trial, carried through the handshake so the recipe it
     *  already extracted lands in the account it is about to create — and
     *  survives finishing sign-up in another tab or on another device, which
     *  a cookie alone would not. */
    trialId: text("trial_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_states_expires_idx").on(table.expiresAt)]
);

/**
 * A browser's Web Push subscription — one row per DEVICE, many per account.
 *
 * `endpoint` is the primary key because the push service's URL *is* the
 * subscription's identity: re-subscribing on the same device with the same
 * VAPID key returns the same endpoint, so an upsert on it is idempotent and
 * a device cannot accumulate duplicate rows by reopening the app.
 *
 * KEYED TO THE ACCOUNT, NOT owner_key. A push subscription is a standing
 * permission to interrupt someone's evening, and owner_key is a browser
 * rather than a person — it survives no sign-out and identifies no one to
 * revoke it. #7 retired it for exactly this class of thing. The practical
 * consequence is that push is signed-in only: a trial recipe has no account
 * to notify, which is a scoping decision rather than a gap.
 *
 * `failed_at` records a 404/410 from the push service, which is the
 * documented "this subscription is dead" signal — the row is deleted on
 * sight, and the column exists for the case where the delete itself fails.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The client's public key and auth secret, from PushSubscription.toJSON(). */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Display only — "iPhone, added 3 May" in Settings. Never matched on. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow(),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (table) => [index("push_subs_user_idx").on(table.userId)]
);

/**
 * One pending "your timer is done" push.
 *
 * WHY THIS IS NOT THE `recipes.timer` COLUMN, which already holds an
 * absolute endsAt and looks like it would do. Three reasons, and each one
 * alone is enough:
 *
 *  1. Writing a `notified_at` marker back into that jsonb would bump the
 *     row's `version`, and every other device on the account would collect a
 *     409 and a merge for a write the user did not make.
 *  2. `mergeTimer` in shared/sync.ts can legitimately REWRITE endsAt while a
 *     conflict resolves, so the column is not a stable target to schedule
 *     against.
 *  3. `recipes` is keyed (owner_key, id); a notification is owed to an
 *     ACCOUNT. Reading a browser-keyed row to decide who to interrupt is the
 *     same confusion push_subscriptions avoids above.
 *
 * There is also a fourth, more immediate one: nothing ever clears
 * `recipes.timer` when a timer finishes, so every recipe anyone has ever
 * timed carries a permanently-past endsAt. A scheduler reading that column
 * would find thousands of rows that are forever due. (That staleness is its
 * own small bug — see ROADMAP — but it is not this table's problem.)
 *
 * The unique (user_id, recipe_id) mirrors the one-timer-per-recipe shape the
 * column already has, so starting a second timer replaces the first rather
 * than queueing a second buzz.
 */
export const timerNotifications = pgTable(
  "timer_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** No FK: recipes' primary key is (owner_key, id), and this table only
     *  ever knows the account. A recipe deleted out from under a pending
     *  timer takes its row with it via the DELETE route. */
    recipeId: text("recipe_id").notNull(),
    stepId: text("step_id").notNull(),
    /** Denormalised at schedule time: these are the notification's title and
     *  body, and reading them at dispatch would mean loading and walking a
     *  recipe tree per timer, for text that cannot change between the tap
     *  that started the timer and the buzz that ends it without the timer
     *  itself being rewritten. */
    stepLabel: text("step_label"),
    recipeTitle: text("recipe_title"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** The claim marker. Non-null means some dispatcher has taken this row;
     *  see claimDueTimers for why that is set before the send and not after. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("timer_notifs_user_recipe_idx").on(table.userId, table.recipeId),
    /** The dispatcher's only query. Partial, because a claimed row is dead
     *  weight in an index that exists to find unclaimed ones. */
    index("timer_notifs_due_idx")
      .on(table.endsAt)
      .where(sql`notified_at is null`),
  ]
);

/**
 * THE ONE ROW APP CODE READS TO DECIDE WHAT SOMEBODY MAY DO.
 *
 * Two separate things live here on purpose, because both are read at the same
 * instant by the same gate and splitting them would buy a join and nothing
 * else: the free tier's ALLOWANCE, and the per-account KILL SWITCH.
 *
 * `recipes_used` IS MONOTONIC. It counts recipes ever added to the account —
 * incremented when one is created and when the pre-signup trial's recipe is
 * claimed, and never decremented when one is deleted. That is the whole
 * difference between "one recipe ever" and "one recipe at a time": counting
 * rows in `recipes` would hand a slot back on every delete, which turns the
 * free tier into an unlimited carousel.
 *
 * `recipe_allowance` starts at 1 and only ever goes up — a coupon adds to it.
 * There is exactly ONE allowance system in this codebase and this is it. The
 * `trials` table above is NOT a second one: it is cookie-keyed, boolean and
 * pre-account, it feeds into this counter through the claim, and it does not
 * change.
 *
 * `enforce_override` is the per-account half of the kill switch. NULL means
 * follow the global flag; TRUE enforces for this account even while the
 * global flag is off (so the owner can live on the paid tier before anyone
 * else does); FALSE never enforces, which is how a comp is given.
 */
export const accountAccess = pgTable("account_access", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  recipeAllowance: integer("recipe_allowance").notNull().default(1),
  recipesUsed: integer("recipes_used").notNull().default(0),
  enforceOverride: boolean("enforce_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * A subscription at a payment provider. Written ONLY by webhook and receipt
 * handlers; app code never reads this table directly, it reads the
 * entitlement derived from it.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION, AND THAT IS NOT SPECULATIVE. This app is
 * going to the App Store, where Apple requires IAP for a subscription that
 * unlocks functionality in-app, and likely to Play, where Google requires
 * Play Billing under the same category of rule. The thing people get wrong is
 * assuming that means MIGRATING off Stripe. It does not: a subscription
 * bought on the web has to keep working forever, so each store adds a
 * provider rather than replacing one. Three live providers is the expected
 * end state, not a contingency.
 *
 * `provider` is therefore a plain string, not an enum, and `provider_ref` is
 * whatever that provider calls its subscription — a `sub_...` id for Stripe,
 * an `original_transaction_id` for Apple, a purchase token for Play. Adding
 * Google later is a new adapter and a new value in this column: NO schema
 * change, no migration, no new table.
 *
 * `status` is NORMALISED — 'active' | 'grace' | 'expired' — never the
 * provider's own string. Stripe's `past_due` and Apple's billing-retry both
 * mean the same thing to this app, and the mapping living in the adapter is
 * the entire provider-agnostic bet. `raw` keeps the last payload so a
 * surprising decision can be traced back to what the provider actually said.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'stripe' | 'apple' | 'google_play' — open by design. */
    provider: text("provider").notNull(),
    provider_ref: text("provider_ref").notNull(),
    /** Normalised: 'active' | 'grace' | 'expired'. Never a provider string. */
    status: text("status").notNull(),
    /** When access lapses if nothing renews it. Named for what it MEANS
     *  rather than for Stripe's `current_period_end`: Apple calls the same
     *  fact `expires_date` and Play `expiryTimeMillis`, and a column named
     *  after one provider is the vocabulary leak this table exists to avoid. */
    renewsAt: timestamp("renews_at", { withTimezone: true }),
    /** Set when the subscription is running out on purpose — Stripe's
     *  `cancel_at_period_end`, Apple's auto-renew-off. */
    willNotRenew: boolean("will_not_renew").notNull().default(false),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_provider_ref_idx").on(table.provider, table.provider_ref),
    index("subscriptions_user_idx").on(table.userId),
  ]
);

/**
 * "N recipes free" codes.
 *
 * NOT "free months" — those are Stripe promotion codes, entered in Stripe
 * Checkout's own field, and there is deliberately no table for them here.
 * Mirroring Stripe's discount engine locally would be building a second
 * billing system to do worse what the first already does. The two coupon
 * mechanics stay separate because they genuinely are separate: one is a
 * billing discount, the other is a usage grant, and only the second one is
 * this app's business.
 */
export const coupons = pgTable("coupons", {
  code: text("code").primaryKey(),
  /** How many recipes this code adds to an account's allowance. */
  recipes: integer("recipes").notNull(),
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code")
      .notNull()
      .references(() => coupons.code),
    /** Frozen at redemption: what the code granted THEN, so later edits to
     *  the coupon never rewrite history someone already spent. */
    recipes: integer("recipes").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex("coupon_redemptions_once_idx").on(table.userId, table.code)]
);

/**
 * Every access decision, including the ones that did not bite.
 *
 * THIS IS WHAT MAKES THE PAYWALL SAFE TO SHIP TURNED OFF. The gate always
 * computes the decision and always writes it here; `enforced` records whether
 * it was allowed to act on it. A row with decision='would_block' is the wall
 * firing in a world where the flag is on — so the logic can be watched
 * against real traffic for as long as it takes to trust it, before it can
 * turn a single person away.
 *
 * Deliberately the same shape and posture as `extraction_events`: written
 * fire-and-forget on the way out, adding no latency, and swallowing its own
 * errors — a logging failure must never be the reason a request fails.
 *
 * Operational, not behavioural: no recipe ids, no URLs, no titles. It answers
 * "would the wall have fired, and why", which is the only question it exists
 * for.
 */
export const accessEvents = pgTable(
  "access_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow(),
    userId: text("user_id"),
    /** 'extract' | 'search' | 'reextract' | 'save' | 'claim' */
    action: text("action").notNull(),
    /** 'allow' | 'block' | 'would_block' */
    decision: text("decision").notNull(),
    /** 'subscribed' | 'within_allowance' | 'exhausted' | 'no_account' */
    reason: text("reason").notNull(),
    allowance: integer("allowance"),
    used: integer("used"),
    enforced: boolean("enforced").notNull(),
  },
  (table) => [index("access_events_at_idx").on(table.at)]
);

/**
 * Privileged writes, and who made them.
 *
 * NOT access_events, and the three reasons are worth writing down because
 * "just add a row to the log we already have" is the obvious move and it is
 * wrong here.
 *
 *  1. IT WOULD CORRUPT THE QUERY THAT TABLE EXISTS FOR. Every column in
 *     access_events answers "would the wall have fired": decision, reason,
 *     allowance, used, enforced. An admin override has none of those
 *     truthfully, so writing one means inventing values — and the query
 *     CLAUDE.md documents as the go/no-go for switching the paywall on
 *     (`select decision, reason, count(*) ... group by 1, 2`) would start
 *     counting operator actions as access decisions. That is the same
 *     denominator corruption the `via` column already taught this codebase
 *     about once.
 *  2. RETENTION PULLS THE TWO APART. access_events grows with every request
 *     and will eventually be pruned. Pruning it must never be the thing that
 *     deletes the record of who was comped and by whom.
 *  3. DURABILITY DIFFERS, and this is the real one. access_events is written
 *     fire-and-forget and swallows its own errors, which is correct for
 *     observability and wrong for the audit trail of a privileged write. A
 *     row here is written in the SAME TRANSACTION as the change it describes,
 *     so an unrecorded override cannot happen: if the audit fails the write
 *     rolls back with it.
 *
 * `before`/`after` are text, not booleans, because the value is a TRI-STATE —
 * true, false, or null-meaning-follow-the-global-flag — and a nullable
 * boolean column could not distinguish "was cleared" from "not recorded".
 */
export const adminEvents = pgTable(
  "admin_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow(),
    /** 'set_enforce_override' — an open string, like subscriptions.provider. */
    action: text("action").notNull(),
    /** No FK on purpose: the audit record must outlive the account it is
     *  about, or deleting a user erases the evidence of what was done to
     *  them. */
    targetUserId: text("target_user_id").notNull(),
    /** 'true' | 'false' | 'null' — see the note above on why not a boolean. */
    before: text("before"),
    after: text("after"),
    /** Best-effort attribution. There is one operator and one shared secret,
     *  so this cannot identify a person — it distinguishes sessions and
     *  locations, which is the most a shared secret can honestly support. */
    actorIp: text("actor_ip"),
    note: text("note"),
  },
  (table) => [index("admin_events_at_idx").on(table.at)]
);
