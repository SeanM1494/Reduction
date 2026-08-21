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
import { setEnforceOverrideAudited } from "../lib/billing/entitlement";
import { appleConfig, clientSecret, describeKeyEnv } from "../lib/apple";

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

/**
 * PATCH /api/admin/user
 * body: { userId: string, enforceOverride: true | false | null }
 *
 * WHY A METHOD AND NOT A QUERY PARAM ON THE GET. A GET must stay safe and
 * idempotent, and this is neither — it changes whether a person can use the
 * app. Hanging it off the existing GET would put a live enforcement switch in
 * every place a URL casually ends up: shell history, a browser's address bar
 * and autocomplete, a prefetch, a copied support note. PATCH costs one more
 * line at the call site and takes all of that off the table.
 *
 * ADDRESSED BY USER ID, NOT EMAIL, which is the deliberate complement to the
 * GET. Email can legitimately match two accounts — that is why the GET
 * returns every match — and a write that fans out to "everyone who shares
 * this address" is a write nobody meant to make. So the GET finds the id, and
 * this takes it.
 */
adminRouter.patch("/user", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) return res.status(422).json({ error: "Pass userId." });

  /**
   * `null` IS A MEANINGFUL VALUE HERE, not an absent one — it clears the
   * override back to "follow the global flag", which is one of the three
   * states the caller can ask for. So this tests for the KEY, not the value:
   * `if (!body.enforceOverride)` would collapse false, null and missing into
   * one branch, and silently turn "clear it" into "force it off" — a
   * different account state that looks identical until the global flag is
   * switched on.
   */
  if (!Object.prototype.hasOwnProperty.call(body, "enforceOverride"))
    return res
      .status(422)
      .json({ error: "Pass enforceOverride: true, false, or null." });

  const value = body.enforceOverride;
  if (value !== true && value !== false && value !== null)
    return res
      .status(422)
      .json({ error: "enforceOverride must be true, false, or null." });

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  try {
    const db = getDb();
    // Confirm the account exists before writing. Without this a typo'd id
    // reaches the foreign key on account_access and surfaces as a 500, which
    // reads like a broken route rather than a wrong id.
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return res.status(404).json({ error: "No account with that id." });

    const { before, after } = await setEnforceOverrideAudited({
      userId,
      value,
      actorIp: req.ip ?? null,
      note,
    });

    console.log(
      `[admin] enforce_override ${userId}: ${String(before)} -> ${String(after)}`
    );
    return res.json({
      userId,
      before,
      after,
      // So a no-op reads as one rather than looking like a successful change.
      changed: before !== after,
    });
  } catch (e) {
    console.error("[admin:patch]", (e as Error).message);
    return res.status(500).json({ error: "Could not update that account." });
  }
});

/**
 * GET /api/admin/preflight/apple
 *
 * WHY THIS EXISTS. Every way Sign in with Apple fails at the token exchange
 * produces one indistinguishable outcome — `invalid_client`, with no detail —
 * and reaching it costs a full round trip through Apple's sheet. Worse, the
 * three things that cause it (a Key ID that does not match the key, a Team ID
 * and Services ID the wrong way round, a key not configured for this Services
 * ID) are all invisible locally: the JWT is well-formed in every one of them.
 *
 * So this reports what the RUNNING PROCESS actually holds, which is the
 * question logs cannot answer: not "what did I put in Secrets" but "what did
 * this deployment boot with". A stale deployment still running a rotated-away
 * key looks identical to a misconfiguration until you can see the Key ID it
 * is signing with.
 *
 * DISCLOSES NO SECRET. The private key is reported only as "does it parse",
 * and the Team ID is fingerprinted rather than printed. The Services ID, Key
 * ID and redirect URI are not secrets — the first two are visible in any
 * authorize request, and the third is registered publicly with Apple.
 */
adminRouter.get("/preflight/apple", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  // Reported in BOTH branches. When the key is the thing that is wrong, the
  // config resolves fine and only the parse fails — so putting this behind
  // `if (!cfg)` would hide it in exactly the case it was written for.
  const keyEnv = describeKeyEnv(process.env.APPLE_PRIVATE_KEY);

  const cfg = appleConfig();
  if (!cfg) {
    // Half-configured reads as unconfigured, so name which parts are missing —
    // otherwise this is the same unhelpful answer it exists to replace.
    const present = {
      APPLE_CLIENT_ID: !!process.env.APPLE_CLIENT_ID?.trim(),
      APPLE_TEAM_ID: !!process.env.APPLE_TEAM_ID?.trim(),
      APPLE_KEY_ID: !!process.env.APPLE_KEY_ID?.trim(),
      APPLE_PRIVATE_KEY: !!process.env.APPLE_PRIVATE_KEY,
      PUBLIC_BASE_URL: !!process.env.PUBLIC_BASE_URL?.trim(),
    };
    return res.json({
      configured: false,
      missing: Object.entries(present)
        .filter(([, v]) => !v)
        .map(([k]) => k),
      note: "With any of these unset the Apple button is hidden and the route 503s.",
      privateKeyEnv: keyEnv,
    });
  }

  const out: Record<string, unknown> = {
    configured: true,
    // The three values worth eyeballing against the console, none secret.
    servicesId: cfg.clientId,
    keyId: cfg.keyId,
    redirectUri: cfg.redirectUri,
    // Enough to tell two Team IDs apart without printing one.
    teamIdLength: cfg.teamId.length,
    teamIdLooksRight: /^[A-Z0-9]{10}$/.test(cfg.teamId),
  };

  try {
    const jwt = clientSecret(cfg);
    const [h, p, sig] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const sigBytes = Buffer.from(sig, "base64url").length;

    out.clientSecret = {
      alg: header.alg,
      kid: header.kid,
      // The swap that produces the other invalid_client. Reported as a
      // boolean pair rather than the values, so it is checkable at a glance.
      issIsTeamId: payload.iss === cfg.teamId,
      subIsServicesId: payload.sub === cfg.clientId,
      audience: payload.aud,
      signatureBytes: sigBytes,
      // 64 = IEEE P1363 (r||s), what JWS ES256 requires. ~70-72 = DER, which
      // Apple rejects as invalid_client while looking perfectly well-formed.
      signatureEncoding: sigBytes === 64 ? "p1363 (correct)" : "DER (Apple will reject)",
      expiresInDays: Math.round((payload.exp - payload.iat) / 86400),
    };
    out.privateKeyParses = true;
  } catch (e) {
    out.privateKeyParses = false;
    out.error = (e as Error).message;
  }

  /**
   * WHAT ACTUALLY LANDED IN THE ENV VAR.
   *
   * "privateKeyParses: false" is the same unhelpful answer as the
   * invalid_client it replaced — it says the value is wrong without saying
   * how, and a paste that reads back correctly can still be wrong in half a
   * dozen invisible ways: a BOM, CRLF, smart dashes, surrounding quotes, or
   * newlines stripped by the secrets UI.
   */
  out.privateKeyEnv = keyEnv;

  return res.json(out);
});
