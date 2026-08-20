/**
 * server/routes/admin.ts — one operator, one lookup.
 *
 * DELIBERATELY NOT AN ADMIN ROLE SYSTEM. There is one operator. Roles,
 * permissions and an admin UI are a real feature with real scope, and none of
 * it is needed to answer "what is this person's user id". A shared secret in
 * a header, and the route 404s without one.
 *
 * THIS IS NOT AN AUTHENTICATION PATH, and the distinction matters because
 * shared/schema.ts states plainly that NOTHING looks an account up by email:
 * Sign in with Apple can hand back a @privaterelay address, and matching
 * accounts on an email string would make an unverified address an
 * account-takeover route. That rule is about deciding WHO SOMEONE IS. This
 * route decides nothing — it is a read, performed by someone who already
 * holds the deployment's secret, and it grants no session and links no
 * identity. If you ever find yourself calling this from a sign-in flow, the
 * rule is being broken and the comment in schema.ts is the one to read.
 */

import { Router, type Request, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, identities, subscriptions, users } from "../../shared/schema";

export const adminRouter = Router();

/**
 * Constant-time compare of a hash of each side.
 *
 * Hashing first means the comparison is fixed-length (timingSafeEqual throws
 * on a mismatch otherwise) AND the length check cannot leak the secret's
 * length, which a bare `a.length !== b.length` guard would. Same helper shape
 * as the timer dispatch route, for the same reasons.
 */
function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A small online-guessing brake.
 *
 * COUNTS FAILURES ONLY, and that is the whole design. A first version counted
 * every request, which throttles the one person the route exists for: an
 * operator working through a support queue does eleven lookups in a minute
 * and gets locked out by a mechanism meant for someone guessing. Successful
 * requests also clear the counter, so a fat-fingered paste followed by a
 * correct one leaves no residue.
 *
 * The secret should be long enough that this is irrelevant, but "should be"
 * is doing a lot of work in that sentence and the cost here is a Map. In
 * memory on purpose: a brake on a live attacker, not an audit trail, and
 * losing it when the deployment sleeps is fine.
 */
const failures = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

function lockedOut(ip: string): boolean {
  const seen = failures.get(ip);
  if (!seen) return false;
  if (Date.now() - seen.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return seen.n >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const seen = failures.get(ip);
  if (!seen || now - seen.first > WINDOW_MS) failures.set(ip, { n: 1, first: now });
  else seen.n++;
}

function clearFailures(ip: string): void {
  failures.delete(ip);
}

/** Test seam: the brake is process-global, so a suite has to be able to
 *  reset it rather than depend on which tests ran before it. */
export function resetAdminThrottle(): void {
  failures.clear();
}

function requireAdmin(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_SECRET?.trim();
  // Unset means the route does not exist, rather than existing unguarded.
  if (!expected) {
    res.status(404).json({ error: "Not found." });
    return false;
  }
  const ip = req.ip ?? "unknown";
  if (lockedOut(ip)) {
    res.status(429).json({ error: "Too many attempts." });
    return false;
  }
  if (!secretMatches(req.get("x-admin-secret"), expected)) {
    recordFailure(ip);
    // Logged because a wrong secret against this route is worth noticing.
    console.error(`[admin] rejected lookup from ${ip}`);
    res.status(401).json({ error: "Bad admin secret." });
    return false;
  }
  clearFailures(ip);
  return true;
}

/**
 * GET /api/admin/user?email=someone@example.com
 *
 * Searches BOTH email columns. `users.email` is the best-known one and is
 * display-only, so it can be stale; `identities.email` is what a provider
 * last said. An operator looking someone up has whichever address the person
 * gave them, and having to guess which column it landed in is exactly the
 * hand-written SQL this route exists to avoid.
 *
 * Returns every match rather than one. Two accounts CAN share an email —
 * there is deliberately no unique constraint, for the account-takeover reason
 * in schema.ts — so collapsing to the first match would quietly hide the
 * second, which is the case an operator most needs to see.
 */
adminRouter.get("/user", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const raw = req.query.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || email.length > 320)
    return res.status(422).json({ error: "Pass ?email=" });

  try {
    const db = getDb();
    // Case-insensitive: addresses get typed from memory and from signatures.
    const matches = await db
      .selectDistinct({ id: users.id })
      .from(users)
      .leftJoin(identities, eq(identities.userId, users.id))
      .where(
        or(
          sql`lower(${users.email}) = ${email}`,
          sql`lower(${identities.email}) = ${email}`
        )
      );

    if (!matches.length) return res.json({ users: [] });

    // One extra round trip for the detail, so the query above stays a plain
    // id search that is easy to reason about.
    const detail = await Promise.all(
      matches.map(async (m) => {
        const [u] = await db.select().from(users).where(eq(users.id, m.id));
        const [access] = await db
          .select()
          .from(accountAccess)
          .where(eq(accountAccess.userId, m.id));
        const subs = await db
          .select({
            provider: subscriptions.provider,
            status: subscriptions.status,
            renewsAt: subscriptions.renewsAt,
          })
          .from(subscriptions)
          .where(eq(subscriptions.userId, m.id));
        return {
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          createdAt: u.createdAt,
          // The operational reason to look someone up is almost always to
          // answer "why can't they add a recipe", so the answer ships with
          // the id rather than needing a second query.
          access: access
            ? {
                allowance: access.recipeAllowance,
                used: access.recipesUsed,
                enforceOverride: access.enforceOverride,
              }
            : null,
          subscriptions: subs,
        };
      })
    );

    // A read of someone else's account leaves a trace, even with one
    // operator — especially with one operator, since there is nobody else to
    // notice.
    console.log(`[admin] looked up ${email}: ${detail.length} match(es)`);
    return res.json({ users: detail });
  } catch (e) {
    console.error("[admin:user]", (e as Error).message);
    return res.status(500).json({ error: "Lookup failed." });
  }
});
