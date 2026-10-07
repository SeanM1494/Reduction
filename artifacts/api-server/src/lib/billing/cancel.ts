/**
 * server/lib/billing/cancel.ts — stop every subscription an account holds,
 * as far as each provider allows, in the provider-agnostic vocabulary.
 *
 * Account deletion's contract (ROADMAP, decided Sep 21) is that deleting
 * the account cancels its subscription in the same action, not as a
 * separate step the person has to remember. What that CAN mean differs by
 * provider, and this file is where the difference is absorbed so the route
 * and the clients never learn a provider's name beyond reporting it:
 *
 *   - stripe: cancelled now, through stripe.ts (the only file that may
 *     speak to Stripe). A failure THROWS, so the caller refuses to delete an
 *     account whose billing it could not stop.
 *   - google_play: cancelled now, through googlePlay.ts (Google lets the
 *     developer stop renewal; the time already paid for runs out on
 *     Google's side). Unlike Stripe a failure does NOT refuse the
 *     deletion: the person can always cancel a Play subscription
 *     themselves, so it is reported under `manual` and the phone says
 *     where, which is better than an account nobody can delete while
 *     Google is unreachable.
 *   - apple (and any other store): nothing a server can cancel. Apple lets
 *     only the subscriber end an App Store subscription, from the device's
 *     own settings, so the provider is returned under `manual` and the
 *     clients say so in the confirm dialog, before and after.
 *
 * Only rows that could still bill (active or grace) are touched. An expired
 * row is history, and cancelling it again would be an error at the
 * provider for no gain.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { subscriptions } from "@workspace/db";
import { cancelStripeSubscriptionNow } from "./stripe";
import { cancelPlaySubscription, GOOGLE_PLAY_PROVIDER, googlePlayConfig, productIdOfStored } from "./googlePlay";

export interface CancelSummary {
  /** Providers whose subscription this server cancelled. */
  cancelled: string[];
  /** Providers whose subscription only the person can cancel. */
  manual: string[];
}

const LIVE: ReadonlySet<string> = new Set(["active", "grace"]);

export async function cancelSubscriptionsFor(userId: string): Promise<CancelSummary> {
  const rows = await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const cancelled = new Set<string>();
  const manual = new Set<string>();
  for (const row of rows) {
    if (!LIVE.has(row.status)) continue;
    if (row.provider === "stripe") {
      await cancelStripeSubscriptionNow(row.provider_ref);
      await getDb()
        .update(subscriptions)
        .set({ status: "expired", willNotRenew: true, updatedAt: new Date() })
        .where(eq(subscriptions.id, row.id));
      cancelled.add(row.provider);
    } else if (row.provider === GOOGLE_PLAY_PROVIDER) {
      const cfg = googlePlayConfig();
      const productId = productIdOfStored(row.raw);
      try {
        if (!cfg || !productId) throw new Error(!cfg ? "adapter not configured" : "no product id stored");
        await cancelPlaySubscription(cfg, row.provider_ref, productId);
        await getDb()
          .update(subscriptions)
          .set({ willNotRenew: true, updatedAt: new Date() })
          .where(eq(subscriptions.id, row.id));
        cancelled.add(row.provider);
      } catch (e) {
        console.error("[billing:cancel] Google Play cancellation failed; left to the person:", (e as Error).message);
        manual.add(row.provider);
      }
    } else {
      manual.add(row.provider);
    }
  }
  return { cancelled: [...cancelled], manual: [...manual] };
}
