/**
 * server/middleware/session.ts — resolves the session cookie onto the request.
 *
 * Runs on every request and never rejects one: this establishes *whether*
 * someone is signed in, it does not require it. Routes decide what to do with
 * the answer — /api/library serves an anonymous owner_key library when there
 * is no session, which is the whole point of keeping anonymous saving alive.
 */

import type { Request, Response, NextFunction } from "express";
import { readCookie } from "../lib/cookies";
import { resolveSession, SESSION_COOKIE } from "../lib/sessions";

export interface RequestSession {
  userId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present and non-null only for a valid, unexpired session. */
      session?: RequestSession | null;
      /** The raw token, kept so logout can revoke the row it points at. */
      sessionToken?: string | null;
    }
  }
}

export async function attachSession(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  req.session = null;
  req.sessionToken = null;

  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return next();

  req.sessionToken = token;
  try {
    const found = await resolveSession(token);
    if (found) req.session = { userId: found.userId };
  } catch (e) {
    // An unreachable database must not turn every page into a 500. Treating
    // this as "not signed in" is safe in the direction that matters: it can
    // only ever show less than the user is entitled to, never more, and the
    // library routes fail loudly on their own if the database is really down.
    console.error("[session] could not resolve session:", (e as Error).message);
  }
  next();
}

/** True when this request carries a valid session. */
export const isSignedIn = (req: Request): boolean => !!req.session?.userId;

/** The signed-in user's id, or null. */
export const userIdOf = (req: Request): string | null => req.session?.userId ?? null;
