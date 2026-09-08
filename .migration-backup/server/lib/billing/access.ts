/**
 * server/lib/billing/access.ts — the gate, and the log that lets it ship off.
 *
 * SHADOW MODE IS THE POINT. `decide()` computes the same answer whether or
 * not the wall is allowed to bite, and `logAccess` records it either way. A
 * row with decision='would_block' is the wall firing in a world where the
 * flag is on, which means the logic can be watched against real traffic for
 * as long as it takes to trust it, before it can turn one person away.
 *
 * The query that answers "is this safe to switch on yet":
 *
 *   select decision, reason, count(*) from access_events
 *    where at > now() - interval '7 days' group by 1, 2;
 *
 * and the one that finds who it would have hit:
 *
 *   select user_id, count(*) from access_events
 *    where decision = 'would_block' group by 1 order by 2 desc;
 */

import type { Request, Response } from "express";
import { getDb } from "../../db";
import { accessEvents } from "../../../shared/schema";
import { userIdOf } from "../../middleware/session";
import { entitlementFor, type Entitlement } from "./entitlement";

export type AccessAction = "extract" | "search" | "reextract" | "save" | "claim";
export type AccessDecision = "allow" | "block" | "would_block";

export interface AccessResult {
  decision: AccessDecision;
  entitlement: Entitlement | null;
  /** True only for a real block — the one case a caller must refuse. */
  blocked: boolean;
}

/**
 * Decide, and record. Never throws: a gate that can 500 is a gate that takes
 * the whole app down when the billing tables are unreachable, and the safe
 * direction for a paywall failing is open.
 */
export async function checkAccess(
  req: Request,
  action: AccessAction
): Promise<AccessResult> {
  const userId = userIdOf(req);

  // No account is not this gate's business. The pre-signup trial has its own
  // one-shot gate (server/lib/trial.ts), which is a different mechanism for a
  // different actor and is deliberately untouched by any of this.
  if (!userId) {
    return { decision: "allow", entitlement: null, blocked: false };
  }

  let ent: Entitlement;
  try {
    ent = await entitlementFor(userId);
  } catch (e) {
    console.error("[access] entitlement unavailable, failing open:", (e as Error).message);
    return { decision: "allow", entitlement: null, blocked: false };
  }

  const decision: AccessDecision = ent.allowed
    ? "allow"
    : ent.enforced
      ? "block"
      : "would_block";

  void logAccess({
    userId,
    action,
    decision,
    reason: ent.reason,
    allowance: ent.allowance,
    used: ent.used,
    enforced: ent.enforced,
  });

  return { decision, entitlement: ent, blocked: decision === "block" };
}

/**
 * Fire-and-forget, and swallows its own errors — the same posture as
 * extractionLog.ts, for the same reason: an observability table must never be
 * the thing that fails a request it was only supposed to watch.
 */
export async function logAccess(event: {
  userId: string | null;
  action: AccessAction;
  decision: AccessDecision;
  reason: string;
  allowance?: number | null;
  used?: number | null;
  enforced: boolean;
}): Promise<void> {
  try {
    await getDb().insert(accessEvents).values({
      userId: event.userId,
      action: event.action,
      decision: event.decision,
      reason: event.reason,
      allowance: event.allowance ?? null,
      used: event.used ?? null,
      enforced: event.enforced,
    });
  } catch (e) {
    console.error("[access] log skipped:", (e as Error).message);
  }
}

/**
 * The 402 body. One shape for every walled route, so the client branches on
 * `code` and never on prose — the convention `trial_spent` already
 * established in client/src/lib/api.ts, and the reason rewording a sentence
 * here cannot silently break the funnel.
 */
export function subscriptionRequired(res: Response, ent: Entitlement | null) {
  return res.status(402).json({
    error: "You've used your free recipe. Subscribe to add more.",
    code: "subscription_required",
    allowance: ent?.allowance ?? null,
    used: ent?.used ?? null,
  });
}
