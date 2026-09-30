/**
 * routes/counters.ts — POST /api/counters: the app reporting one of a closed
 * list of anonymous events (lib/counters.ts CLIENT_COUNTERS). Signed in only,
 * so a stranger cannot inflate them; the account is NOT recorded — the
 * sign-in check is the gate, not a column.
 *
 * A per-account brake, in memory: a miss across instances only lets a few
 * more counts through, which is the harmless direction (CLAUDE.md, "Nothing
 * that spans two requests may live in process memory").
 */

import { Router, type Request, type Response } from "express";
import { countEvent, isClientCounter } from "../lib/counters";
import { userIdOf } from "../middleware/session";

export const countersRouter = Router();

const PER_HOUR = 120;
const hits = new Map<string, number[]>();

export function resetCounterBrake(): void {
  hits.clear();
}

countersRouter.post("/", (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const name = (req.body ?? {}).name;
  if (!isClientCounter(name)) return res.status(400).json({ error: "Unknown counter." });
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) return res.status(429).json({ error: "Too many." });
  recent.push(now);
  hits.set(userId, recent);
  void countEvent(name);
  return res.status(204).end();
});
