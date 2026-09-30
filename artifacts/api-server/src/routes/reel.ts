/**
 * routes/reel.ts — GET /api/reel: the starter reel for Add New and the empty
 * library (lib/reel.ts has the rules, lib/reelStore.ts the data).
 *
 * Signed in, NOT behind the wall — a list of cached pages costs nothing to
 * look at — but EMPTY for an account the wall has stopped: tapping a card
 * is an extraction, which IS walled, and a reel that led only to a wall
 * would be the bait-and-switch the paywall notes warn against.
 *
 * The built reel is kept in memory for an hour per instance. A miss only
 * rebuilds it (a few milliseconds of reads), which is the harmless kind of
 * miss process memory is allowed (CLAUDE.md). The owner's admin writes
 * clear this instance's copy at once; others catch up within the hour.
 */

import { Router, type Request, type Response } from "express";
import { userIdOf } from "../middleware/session";
import { entitlementFor } from "../lib/billing/entitlement";
import { buildReel, type ReelBuild } from "../lib/reelStore";
import { reelPhotoRow } from "../lib/reelPhotos";

export const reelRouter = Router();

export const REEL_CACHE_MS = 60 * 60 * 1000;
const PER_HOUR = 30;

let memo: { at: number; reel: ReelBuild } | null = null;
const hits = new Map<string, number[]>();

/** For the admin routes (a change is seen at once here) and the tests. */
export function clearReelMemo(): void {
  memo = null;
}
export function resetReelBrake(): void {
  hits.clear();
}

export async function currentReel(): Promise<ReelBuild> {
  if (memo && Date.now() - memo.at < REEL_CACHE_MS) return memo.reel;
  const reel = await buildReel();
  memo = { at: Date.now(), reel };
  return reel;
}

reelRouter.get("/", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) return res.status(429).json({ error: "Too many requests." });
  recent.push(now);
  hits.set(userId, recent);

  try {
    const ent = await entitlementFor(userId);
    if (!ent.allowed && ent.enforced) return res.json({ heading: null, cards: [] });
    const reel = await currentReel();
    // The public shape: the cards and the heading, nothing about why other
    // pages were left out.
    return res.json({ heading: reel.cards.length ? reel.heading : null, cards: reel.cards });
  } catch (e) {
    // Decoration: a reel that cannot be built is a reel that is not shown.
    console.error("[reel]", (e as Error).message);
    return res.json({ heading: null, cards: [] });
  }
});

/**
 * GET /api/reel/photo/:key?v=<version> — a reel card's picture: the page's
 * own image as this server stored it (lib/reelPhotos.ts). Signed in, like
 * the reel; not braked, because a reel of ten cards is ten of these and
 * each is one indexed read. The version in the URL makes `immutable`
 * honest: a replaced picture has a new URL.
 */
reelRouter.get("/photo/:key", async (req: Request, res: Response) => {
  if (!userIdOf(req)) return res.status(401).json({ error: "Sign in first." });
  const key = String(req.params.key);
  if (!/^[0-9a-f]{64}$/.test(key)) return res.status(404).json({ error: "No picture." });
  try {
    const photo = await reelPhotoRow(key);
    if (!photo) return res.status(404).json({ error: "No picture." });
    res.setHeader("Content-Type", photo.mediaType);
    res.setHeader("Content-Length", String(photo.bytes.length));
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("ETag", `"r${photo.version}"`);
    return res.end(photo.bytes);
  } catch (e) {
    console.error("[reel:photo]", (e as Error).message);
    return res.status(500).json({ error: "Could not load the picture." });
  }
});
