/**
 * server/lib/billing/entitlement.ts — "may this account do this, and why?"
 *
 * THE ONE MODULE APP CODE ASKS. Nothing outside server/lib/billing/ may
 * import a payment SDK or read a provider-shaped field; everything asks
 * `entitlementFor(userId)` and branches on the answer. That rule is free
 * today and is the entire difference later, because the expensive failure is
 * never the schema — it is provider vocabulary escaping into code that
 * outlives the provider. A `current_period_end` in UI copy, a
 * `cancel_at_period_end` behind a settings toggle, a `status === 'past_due'`
 * in a middleware: each one is a separate small rewrite the first time a
 * second provider appears, and Apple has no equivalent of any of them.
 *
 * THREE PROVIDERS IS THE EXPECTED END STATE, NOT A CONTINGENCY. This app is
 * going to the App Store, where Apple requires IAP for subscriptions that
 * unlock in-app functionality, and likely to Play under the same category of
 * rule. Neither is a migration: a subscription bought on the web has to keep
 * working forever, so each store ADDS a provider. `subscriptions.provider` is
 * an open string and `provider_ref` holds whatever that provider calls its
 * subscription, so 'google_play' is a new adapter file and a new value — no
 * schema change, no migration, no new table, and not one line of this file.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { accountAccess, subscriptions } from "../../../shared/schema";

/** Normalised across providers. Never a provider's own string. */
export type SubStatus = "active" | "grace" | "expired";

export type EntitlementReason =
  | "subscribed"
  | "within_allowance"
  | "exhausted"
  | "no_account";

export interface Entitlement {
  userId: string;
  /** May they add another recipe right now? */
  allowed: boolean;
  reason: EntitlementReason;
  /** True while a subscription is active OR inside its grace window. */
  subscribed: boolean;
  status: SubStatus | null;
  /** Which provider is paying for this, when one is. Display and support
   *  only — never branch app behaviour on it. */
  provider: string | null;
  allowance: number;
  used: number;
  /** Resolved kill switch: is the wall allowed to bite for this account? */
  enforced: boolean;
}

/**
 * The global kill switch. OFF unless explicitly turned on.
 *
 * Read per call rather than memoised: this is one env lookup, and a flag you
 * cannot flip without a redeploy is a flag you will not flip.
 */
export function paywallEnforcedGlobally(): boolean {
  const raw = process.env.PAYWALL_ENFORCED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/**
 * GRACE IS NOT A LOCAL TIMER, AND DELIBERATELY SO.
 *
 * Stripe's default dunning is 8 attempts over roughly 2 weeks, and when they
 * are exhausted Stripe moves the subscription to `canceled` or `unpaid`
 * according to a Dashboard setting. Both of those numbers are settings the
 * account owner can change. So a local "grace ends after 14 days" constant
 * would be a copy of a value that lives somewhere else and can drift from it
 * silently — the failure mode being someone cut off while Stripe is still
 * happily retrying their card, or kept on long after Stripe gave up.
 *
 * Instead: grace IS the provider's retry window, by definition. `past_due`
 * maps to 'grace' and stays there until the provider itself says the
 * subscription ended. There is no timer here to get wrong, and changing the
 * retry policy in the Stripe Dashboard changes this app's behaviour with no
 * deploy.
 */
const ENTITLING: ReadonlySet<SubStatus> = new Set<SubStatus>(["active", "grace"]);

/** Lazily create the row. First read for an account is also its creation. */
async function ensureAccess(userId: string) {
  const db = getDb();
  await db
    .insert(accountAccess)
    .values({ userId })
    .onConflictDoNothing({ target: accountAccess.userId });
  const [row] = await db
    .select()
    .from(accountAccess)
    .where(eq(accountAccess.userId, userId));
  return row;
}

/**
 * The best subscription this account holds, across every provider.
 *
 * "Best" rather than "latest" because someone can genuinely hold two: a web
 * subscription from before the app shipped on the App Store, and an IAP one
 * bought later. An active one beats a grace one beats an expired one, and
 * double-charging is the user's problem to resolve with a refund, never a
 * reason for this app to serve them less than they are paying for.
 */
async function bestSubscription(userId: string) {
  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.renewsAt));
  const rank = (s: string) => (s === "active" ? 2 : s === "grace" ? 1 : 0);
  let best: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (!best || rank(r.status) > rank(best.status)) best = r;
  }
  return best;
}

export async function entitlementFor(userId: string): Promise<Entitlement> {
  const [access, sub] = await Promise.all([ensureAccess(userId), bestSubscription(userId)]);

  const status = (sub?.status as SubStatus | undefined) ?? null;
  const subscribed = status != null && ENTITLING.has(status);

  const allowance = access?.recipeAllowance ?? 1;
  const used = access?.recipesUsed ?? 0;

  // The per-account override wins over the global flag in BOTH directions:
  // true enforces while the world is still free, false comps an account while
  // the world is paying.
  const enforced = access?.enforceOverride ?? paywallEnforcedGlobally();

  const reason: EntitlementReason = subscribed
    ? "subscribed"
    : used < allowance
      ? "within_allowance"
      : "exhausted";

  return {
    userId,
    // `allowed` is the TRUTH of the rule, not the effect of it. Whether the
    // wall actually bites is `enforced`, applied by the caller — which is
    // what makes shadow mode possible: the decision is computed identically
    // whether or not it is permitted to act.
    allowed: reason !== "exhausted",
    reason,
    subscribed,
    status,
    provider: sub?.provider ?? null,
    allowance,
    used,
    enforced,
  };
}

/**
 * Spend one unit of allowance.
 *
 * Conditional in SQL rather than read-then-write: two devices saving at once
 * must not both see used=0 and both pass. Returns false when there was
 * nothing left to spend, and the caller decides whether that is fatal (it is
 * not, while the flag is off).
 *
 * A subscriber is never metered — the increment is skipped entirely, so
 * `recipes_used` stays a record of the FREE tier's consumption and does not
 * become a lifetime recipe count that means something different for paying
 * and non-paying accounts.
 */
export async function spendRecipeAllowance(userId: string): Promise<boolean> {
  await ensureAccess(userId);
  const rows = await getDb()
    .update(accountAccess)
    .set({ recipesUsed: sql`${accountAccess.recipesUsed} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(accountAccess.userId, userId),
        sql`${accountAccess.recipesUsed} < ${accountAccess.recipeAllowance}`
      )
    )
    .returning({ used: accountAccess.recipesUsed });
  return rows.length > 0;
}

/**
 * Spend a unit unconditionally, for a path that has already decided to
 * proceed — a save that happened while the flag was off, so the counter still
 * reflects reality when the flag goes on.
 *
 * Without this, every recipe saved during the shadow period would be
 * invisible to the counter, and flipping the flag would hand everyone a fresh
 * free recipe on top of what they already have.
 */
export async function recordRecipeUsed(userId: string): Promise<void> {
  await ensureAccess(userId);
  await getDb()
    .update(accountAccess)
    .set({ recipesUsed: sql`${accountAccess.recipesUsed} + 1`, updatedAt: new Date() })
    .where(eq(accountAccess.userId, userId));
}

/** Coupon grant, and the only thing that raises an allowance. */
export async function grantRecipes(userId: string, n: number): Promise<void> {
  await ensureAccess(userId);
  await getDb()
    .update(accountAccess)
    .set({
      recipeAllowance: sql`${accountAccess.recipeAllowance} + ${n}`,
      updatedAt: new Date(),
    })
    .where(eq(accountAccess.userId, userId));
}

/** Admin/testing: force the wall on or off for one account. */
export async function setEnforceOverride(
  userId: string,
  value: boolean | null
): Promise<void> {
  await ensureAccess(userId);
  await getDb()
    .update(accountAccess)
    .set({ enforceOverride: value, updatedAt: new Date() })
    .where(eq(accountAccess.userId, userId));
}
