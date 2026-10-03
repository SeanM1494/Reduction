/**
 * server/lib/appleTokens.ts — the Sign in with Apple refresh token, kept so
 * that deleting an account can revoke it (schema `apple_tokens` says why).
 *
 * Two rules, and both are about what this file must never cost:
 *
 *  1. A SIGN-IN NEVER FAILS HERE. The table is hand-run DDL, so between a
 *     deploy and the CREATE TABLE every write would throw; a write that
 *     fails is logged and the sign-in carries on. The token is for a
 *     courtesy at deletion time, and a person locked out of their account
 *     over it would be the worse failure by far.
 *  2. A DELETION NEVER FAILS HERE EITHER. Apple's own guidance is that the
 *     account is deleted whether or not the tokens can be revoked, so every
 *     read and every revocation is caught, and what could not be revoked is
 *     reported as `manual` — the client then tells the person to remove the
 *     app from Settings › Apple Account › Sign in with Apple themselves.
 *
 * Revocation runs AFTER the account's rows are gone (routes/account.ts):
 * the reverse order would end someone's Apple link and then, on a failed
 * transaction, leave them an account they still have.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appleTokens, identities } from "@workspace/db";
import { appleConfig, revokeRefreshToken } from "./apple";

/** Records (or replaces) the token for this Apple subject. Never throws. */
export async function rememberAppleToken(userId: string, subject: string, refreshToken: string | null): Promise<void> {
  if (!refreshToken) return;
  try {
    await getDb()
      .insert(appleTokens)
      .values({ subject, userId, refreshToken })
      .onConflictDoUpdate({
        target: appleTokens.subject,
        set: { userId, refreshToken, updatedAt: sql`now()` },
      });
  } catch (e) {
    console.warn(`[auth:apple] refresh token not stored for ${userId}:`, (e as Error).message.split("\n")[0]);
  }
}

/**
 * What deleting this account will have to revoke, read BEFORE the rows go
 * (the cascade takes `apple_tokens` with the user). `subjects` is every
 * Apple identity the account has; `tokens` is the ones a token was kept
 * for. A subject without a token is one the person has to remove by hand.
 */
export interface ApplePlan {
  subjects: number;
  tokens: string[];
}

/** Never throws: an identities read that fails is answered as one Apple
 *  identity with no token, which can only ever say "remove it by hand". */
export async function applePlanFor(userId: string): Promise<ApplePlan> {
  const db = getDb();
  let subjects: number;
  try {
    const ids = await db
      .select({ subject: identities.subject })
      .from(identities)
      .where(and(eq(identities.userId, userId), eq(identities.provider, "apple")));
    subjects = ids.length;
  } catch (e) {
    console.warn(`[account:delete] ${userId}: identities not readable:`, (e as Error).message.split("\n")[0]);
    return { subjects: 1, tokens: [] };
  }
  if (!subjects) return { subjects: 0, tokens: [] };
  let tokens: string[] = [];
  try {
    const rows = await db
      .select({ refreshToken: appleTokens.refreshToken })
      .from(appleTokens)
      .where(eq(appleTokens.userId, userId));
    tokens = rows.map((r) => r.refreshToken);
  } catch (e) {
    console.warn(`[account:delete] ${userId}: Apple tokens not readable:`, (e as Error).message.split("\n")[0]);
  }
  return { subjects, tokens };
}

/**
 * `revoked`: every Apple identity on the account had a token, and Apple took
 * every revocation. `manual`: anything less — the person is told to remove
 * the app themselves. `null`: the account never used Sign in with Apple.
 */
export type AppleSignInOutcome = "revoked" | "manual" | null;

type Revoke = (refreshToken: string) => Promise<void>;
let revokeSeam: Revoke | null = null;

/** TEST SEAM, refused in production like the billing seams: a stub here
 *  makes "revoked" a lie. */
export function setAppleRevokeForTests(fn: Revoke | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setAppleRevokeForTests is a test seam and must not be called in production.");
  }
  revokeSeam = fn;
}

/** Never throws. */
export async function revokeApplePlan(userId: string, plan: ApplePlan): Promise<AppleSignInOutcome> {
  if (!plan.subjects) return null;
  let revoke: Revoke | null = revokeSeam;
  if (!revoke) {
    const cfg = appleConfig();
    revoke = cfg ? (token) => revokeRefreshToken(cfg, token) : null;
  }
  if (!revoke) {
    console.warn(`[account:delete] ${userId}: Apple is not configured here, nothing revoked`);
    return "manual";
  }
  let revoked = 0;
  for (const token of plan.tokens) {
    try {
      await revoke(token);
      revoked++;
    } catch (e) {
      console.warn(`[account:delete] ${userId}: Apple revocation failed:`, (e as Error).message.split("\n")[0]);
    }
  }
  return revoked >= plan.subjects ? "revoked" : "manual";
}
