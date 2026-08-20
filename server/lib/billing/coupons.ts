/**
 * server/lib/billing/coupons.ts — "N recipes free".
 *
 * ONE OF THE TWO COUPON MECHANICS, AND THE ONLY ONE THIS APP IMPLEMENTS.
 *
 *   "3 months free"   -> a BILLING DISCOUNT. Stripe promotion codes, entered
 *                        in Stripe Checkout's own field. There is no table
 *                        for it here and there should not be: mirroring
 *                        Stripe's discount engine locally would be building a
 *                        second billing system to do worse what the first
 *                        already does, and it would have to be built a third
 *                        time for Apple.
 *
 *   "10 recipes free" -> a USAGE GRANT. Not a discount at all — it does not
 *                        touch money, a subscription, or a provider. It adds
 *                        to the account's allowance, which is the mechanism
 *                        the free tier already runs on. That is this file.
 *
 * Forcing both through one system would mean either teaching Stripe about
 * recipe counts (it has no such concept) or teaching this app about
 * proration (it should never have one).
 *
 * THE ALLOWANCE IT ADDS TO IS THE ONLY ONE IN THE CODEBASE. The `trials`
 * table is not a second allowance system — it is cookie-keyed, boolean and
 * pre-account, it feeds this counter through the signup claim, and nothing
 * here touches it.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { coupons, couponRedemptions } from "../../../shared/schema";
import { grantRecipes } from "./entitlement";

export type RedeemOutcome =
  | { ok: true; recipes: number }
  | {
      ok: false;
      code:
        | "unknown_code"
        | "already_redeemed"
        | "expired"
        | "exhausted";
    };

/** Codes are case- and space-insensitive: they get typed off a screenshot, a
 *  sticker or a podcast, and rejecting "meg 10" for its space is a support
 *  ticket rather than a security property. */
export const normaliseCode = (raw: string) =>
  raw.trim().replace(/\s+/g, "").toUpperCase();

/**
 * Redeem, once per account per code.
 *
 * The whole thing is one transaction and the redemption row is inserted
 * BEFORE the grant, so its unique (user_id, code) index is what enforces
 * once-only rather than a read-then-write that two taps can both pass. A
 * double-tap gets a duplicate-key violation and rolls back, which is the
 * correct outcome and needs no lock.
 */
/** SQLSTATE 23505, wherever Drizzle has buried it. Code rather than message,
 *  so renaming the index cannot turn this back into a 500. */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function redeemCoupon(
  userId: string,
  rawCode: string
): Promise<RedeemOutcome> {
  const code = normaliseCode(rawCode);
  if (!code) return { ok: false, code: "unknown_code" };

  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      const [coupon] = await tx.select().from(coupons).where(eq(coupons.code, code));
      if (!coupon || !coupon.active) return { ok: false as const, code: "unknown_code" as const };
      if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now())
        return { ok: false as const, code: "expired" as const };

      // Claim a slot conditionally, so a code with 100 redemptions cannot go
      // to 101 under concurrency.
      if (coupon.maxRedemptions != null) {
        const claimed = await tx
          .update(coupons)
          .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
          .where(
            and(
              eq(coupons.code, code),
              sql`${coupons.redeemedCount} < ${coupons.maxRedemptions}`
            )
          )
          .returning({ code: coupons.code });
        if (!claimed.length) return { ok: false as const, code: "exhausted" as const };
      } else {
        await tx
          .update(coupons)
          .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
          .where(eq(coupons.code, code));
      }

      await tx.insert(couponRedemptions).values({
        id: randomUUID(),
        userId,
        code,
        // Frozen at redemption: editing the coupon later must not rewrite
        // what somebody already spent.
        recipes: coupon.recipes,
      });

      await grantRecipes(userId, coupon.recipes);
      return { ok: true as const, recipes: coupon.recipes };
    });
  } catch (e) {
    // The unique index doing its job is the EXPECTED path for a second
    // attempt, not an error.
    //
    // Matched on SQLSTATE 23505 (unique_violation) rather than on message
    // text, and walked down the cause chain to find it: Drizzle wraps the
    // driver error, so `.message` is only ever "Failed query: insert into
    // ..." and the constraint name lives on `.cause`. Matching the message
    // silently fell through to a 500 that told the user "could not redeem"
    // when the truth was "you already did" — and the test missed it, because
    // it counted a thrown rejection as a successful refusal.
    if (isUniqueViolation(e)) return { ok: false, code: "already_redeemed" };
    throw e;
  }
}

/** What an account has already redeemed — Settings shows this so a code is
 *  not typed twice in confusion. */
export async function redemptionsFor(userId: string) {
  return getDb()
    .select({
      code: couponRedemptions.code,
      recipes: couponRedemptions.recipes,
      redeemedAt: couponRedemptions.redeemedAt,
    })
    .from(couponRedemptions)
    .where(eq(couponRedemptions.userId, userId));
}

/** Admin helper, used by tests and by hand-created codes. */
export async function createCoupon(params: {
  code: string;
  recipes: number;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
}) {
  await getDb()
    .insert(coupons)
    .values({
      code: normaliseCode(params.code),
      recipes: params.recipes,
      maxRedemptions: params.maxRedemptions ?? null,
      expiresAt: params.expiresAt ?? null,
    })
    .onConflictDoNothing({ target: coupons.code });
}
