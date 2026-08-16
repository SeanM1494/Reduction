/**
 * server/lib/accounts.ts — turning a provider identity into a user.
 *
 * One user, many identities. An identity is found by (provider, subject) and
 * by nothing else — never by email. See the comment on the identities table
 * in shared/schema.ts for why matching on email would be a takeover path
 * rather than a convenience.
 */

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { identities, users } from "../../shared/schema";

export interface ProviderIdentity {
  provider: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

/**
 * Returns the user id for this identity, creating the user on first sign-in.
 *
 * Both branches run in one transaction: a users row without its identity is
 * an account nobody can ever sign into again, which is worse than a failed
 * sign-in the visitor can simply retry.
 */
export async function userIdForIdentity(input: ProviderIdentity): Promise<string> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.provider, input.provider),
          eq(identities.subject, input.subject)
        )
      );

    if (existing) {
      // Refresh what the provider tells us, but only when it tells us
      // something: Apple sends the name on the first authorization only, and
      // overwriting a known name with null on every later sign-in would lose
      // it permanently.
      if (input.email !== null) {
        await tx
          .update(identities)
          .set({ email: input.email, emailVerified: input.emailVerified })
          .where(
            and(
              eq(identities.provider, input.provider),
              eq(identities.subject, input.subject)
            )
          );
      }
      if (input.displayName || input.email) {
        const patch: { displayName?: string; email?: string } = {};
        if (input.displayName) patch.displayName = input.displayName;
        if (input.email) patch.email = input.email;
        await tx.update(users).set(patch).where(eq(users.id, existing.userId));
      }
      return existing.userId;
    }

    const userId = crypto.randomUUID();
    await tx.insert(users).values({
      id: userId,
      displayName: input.displayName,
      email: input.email,
    });
    await tx.insert(identities).values({
      provider: input.provider,
      subject: input.subject,
      userId,
      email: input.email,
      emailVerified: input.emailVerified,
    });
    return userId;
  });
}
