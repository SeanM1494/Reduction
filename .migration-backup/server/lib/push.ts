/**
 * server/lib/push.ts — Web Push delivery, and the subscription table.
 *
 * WHY A LIBRARY HERE AND NOT FOR OAUTH. The Google sign-in flow is hand-
 * rolled in server/lib/google.ts because OAuth is a protocol of redirects and
 * form posts, where the library mostly hides which parameter goes where.
 * Web Push is not that: a payload is AES-128-GCM sealed against an ECDH
 * shared secret derived from the browser's P-256 key, with an HKDF ladder and
 * a VAPID ES256 JWT on top. Getting a byte wrong there fails closed and
 * silently, and nothing in the response tells you which byte. `web-push` is
 * the reference implementation of RFC 8291; this file is a thin, typed
 * boundary around it so nothing else in the codebase imports it directly.
 *
 * CONFIGURATION IS OPTIONAL AND ABSENCE IS NOT AN ERROR. With no VAPID keys
 * set, `pushConfig()` returns null, `GET /api/push/config` reports no public
 * key, and the client hides the toggle rather than offering a control that
 * cannot work — the same posture googleConfig() takes for the sign-in button.
 * A missing key must never turn a timer into a 500.
 */

import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscriptions } from "../../shared/schema";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let configured: PushConfig | null | undefined;

/** Null when push is not configured. Memoised, because it is read per send. */
export function pushConfig(): PushConfig | null {
  if (configured !== undefined) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  // RFC 8292 wants a contact the push service can reach if a sender
  // misbehaves. Apple rejects a subject that is not a mailto: or https: URL,
  // so an unset one is treated as unconfigured rather than defaulted.
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    configured = null;
    return null;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = { publicKey, privateKey, subject };
  return configured;
}

/** Test seam: lets a suite drive the config without touching process.env. */
export function resetPushConfigCache(): void {
  configured = undefined;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface TimerPayload {
  kind: "timer";
  title: string;
  body: string;
  recipeId: string;
  stepId: string;
}

export type SendOutcome = "sent" | "gone" | "failed" | "unconfigured";

/**
 * One push to one device.
 *
 * A 404 or 410 is the push service saying the subscription is permanently
 * dead — the user removed the web app, or the service rotated it. That is
 * the documented signal to stop sending, and it is reported separately from
 * a transient failure so the caller can delete the row rather than retry it
 * forever. Everything else is "failed" and may be retried.
 */
export async function sendPush(
  target: PushTarget,
  payload: TimerPayload
): Promise<SendOutcome> {
  const cfg = pushConfig();
  if (!cfg) return "unconfigured";
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      {
        // A cooking timer is worthless late. If the device is unreachable for
        // three minutes the moment has passed, so let it expire rather than
        // buzz someone about a pan they already took off the heat.
        TTL: 180,
        urgency: "high",
      }
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error(
      `[push] send failed (${status ?? "no status"}):`,
      (e as Error).message
    );
    return "failed";
  }
}

/** Every live subscription for an account — a timer buzzes each of someone's
 *  devices, because the one they left in the kitchen is the one they are not
 *  holding. */
export async function subscriptionsFor(userId: string): Promise<PushTarget[]> {
  const rows = await getDb()
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows;
}

/**
 * Upsert on `endpoint`, because the push service's URL is the subscription's
 * identity: the same device re-subscribing returns the same endpoint, so this
 * cannot accumulate duplicates however many times the app is reopened.
 *
 * The user_id is overwritten on conflict on purpose. Two accounts on one
 * phone means the second sign-in takes the endpoint over — which is correct,
 * since only one of them is now signed in, and the alternative is buzzing a
 * device about a previous user's dinner.
 */
export async function saveSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({
      endpoint: params.endpoint,
      userId: params.userId,
      p256dh: params.p256dh,
      auth: params.auth,
      userAgent: params.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: params.userId,
        p256dh: params.p256dh,
        auth: params.auth,
        userAgent: params.userAgent ?? null,
        lastUsedAt: sql`now()`,
        // A resubscribe revives a row an earlier 410 had condemned.
        failedAt: null,
      },
    });
}

/** Scoped to the account: a stolen endpoint string must not let anyone
 *  unsubscribe someone else's device. */
export async function deleteSubscription(
  userId: string,
  endpoint: string
): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );
}

/** Called when a send comes back 404/410. Unscoped by user on purpose — the
 *  push service has said this endpoint is dead for everyone. */
export async function dropDeadSubscription(endpoint: string): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}
