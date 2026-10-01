/**
 * routes/crash.ts — POST /api/crash: one crash report from the phone or the
 * website (lib/crashReports.ts).
 *
 * Signed in or not: the crashes that matter most happen before sign-in (the
 * opening sequence, the sign-in screen itself). The session is never read,
 * so no report can be tied to an account even by accident.
 *
 * Always 204 for a report, stored or not — a client has nothing useful to do
 * with "the table is missing" or "the cap is reached", and a crash reporter
 * that retries is how one bug becomes a flood. 400 for a body that is not a
 * report, 429 past the per-client brake.
 *
 * The brake keys on `clientKey(req)`, never `req.ip` (CLAUDE.md), and is in
 * memory on purpose: a miss across instances only lets a few more through,
 * and the daily cap in the insert bounds the table regardless. The key is
 * not stored anywhere.
 */

import { Router, type Request, type Response } from "express";
import { sanitizeCrashReport } from "@workspace/recipe-model/crashReport";
import { clientKey } from "../lib/clientAddress";
import { recordCrash } from "../lib/crashReports";

export const crashRouter = Router();

export const CRASH_PER_HOUR = 10;
const hits = new Map<string, number[]>();

export function resetCrashBrake(): void {
  hits.clear();
}

crashRouter.post("/", (req: Request, res: Response) => {
  const report = sanitizeCrashReport(req.body);
  if (!report) return res.status(400).json({ error: "Not a crash report." });
  const key = clientKey(req);
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= CRASH_PER_HOUR) return res.status(429).json({ error: "Too many." });
  recent.push(now);
  hits.set(key, recent);
  // Bounded: the oldest client's window is dropped when the map gets large,
  // so a spray of forged addresses cannot grow this without limit.
  if (hits.size > 10_000) hits.delete(hits.keys().next().value!);
  void recordCrash(report);
  return res.status(204).end();
});
