/**
 * routes/adminReel.ts — the owner's controls for the starter reel, behind
 * the admin secret (mounted on adminRouter at /api/admin/reel):
 *
 *   GET    /reel          the list (curated / hidden) and a PREVIEW of the
 *                         reel as a stranger would get it now — the dry run,
 *                         with what was left out and why: no stored picture
 *                         (named), and cards withheld below the minimum
 *   PUT    /reel          { url, status: "curated" | "hidden", note? }
 *   DELETE /reel?url=     takes a URL off the list
 *   POST   /reel/warm     { url, write?, refresh?, note? } — one URL a call
 *
 * WARM REPORTS BY DEFAULT and changes nothing. With `write: true` it
 * extracts a URL that is not cached (once, through the same reading path
 * as a link extraction) and records it as curated with a pinned copy; a
 * cached row the report FLAGS (it predates the step order, the picture or
 * the original wording) is re-read only when the call also says
 * `refresh: true` for that URL — so nothing is re-extracted without the
 * owner naming it. Every write is audited in admin_events (target "(reel)",
 * the URL in the note) and every model call is logged in extraction_events
 * as `warmup`, so it shows in the cost report.
 */

import type { Request, Response, Router } from "express";
import crypto from "node:crypto";
import { adminEvents } from "@workspace/db";
import { getDb } from "../db";
import { surfaceableUrl } from "../lib/searchLibrary";
import { urlKeyOf } from "../lib/urlKey";
import { cardFrom, reelMinCards, staleFlags } from "../lib/reel";
import { buildReel, deleteEntry, isMissingTable, loadEntries, upsertEntry, type EntryStatus } from "../lib/reelStore";
import { cacheDropUrl, cacheGetUrlRow, cacheSetUrl, keepOriginal } from "./recipes";
import { clearReelMemo } from "./reel";
import { readRecipeAtUrl } from "../lib/readRecipe";
import { extractionOriginal } from "../lib/original";
import { recordExtraction, hostOf } from "../lib/extractionLog";
import { estimateCostUsd } from "../lib/extractionCost";
import { clientKey } from "../lib/clientAddress";
import { pageImageOf, storeReelPhoto, type ReelPhotoOutcome } from "../lib/reelPhotos";
import type { CallUsage } from "../lib/extractionConfig";

const urlHash = (url: string) => crypto.createHash("sha256").update(`url:${url}`).digest("hex");

/** The reading path a warm uses: the link extraction's own. Replaceable only
 *  by the tests, which cannot reach a real recipe site (the fetcher refuses
 *  loopback addresses, as it should). */
let readAtUrl: typeof readRecipeAtUrl = readRecipeAtUrl;
export function setWarmReaderForTests(fn: typeof readRecipeAtUrl | null): void {
  readAtUrl = fn ?? readRecipeAtUrl;
}

async function audit(req: Request, before: string | null, after: string, note: string) {
  await getDb().insert(adminEvents).values({
    action: "reel",
    // admin_events requires a target; the reel's is the list itself.
    targetUserId: "(reel)",
    before,
    after,
    actorIp: clientKey(req),
    note: note.slice(0, 500),
  });
}

const schemaBehind = (res: Response) =>
  res.status(503).json({ error: 'No reel_entries table yet. Run the SQL in README "Starter recipes reel".', code: "schema_behind" });

export function registerReelAdmin(router: Router, requireAdmin: (req: Request, res: Response) => boolean) {
  router.get("/reel", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const entries = await loadEntries();
      const { photoFill: _fill, ...preview } = await buildReel();
      clearReelMemo();
      return res.json({
        entries: entries.map((e) => ({ url: e.url, status: e.status, note: e.note, pinned: !!e.pinned, updatedAt: e.updatedAt })),
        preview: { ...preview, minCards: reelMinCards() },
      });
    } catch (e) {
      console.error("[admin:reel]", (e as Error).message);
      return res.status(500).json({ error: "Could not build the reel." });
    }
  });

  router.put("/reel", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { url, status, note } = req.body ?? {};
    if (typeof url !== "string" || !urlKeyOf(url)) return res.status(400).json({ error: "Send a url." });
    if (status !== "curated" && status !== "hidden") return res.status(400).json({ error: 'status is "curated" or "hidden".' });
    if (status === "curated" && !surfaceableUrl(url))
      return res.status(422).json({ error: "Only a public-looking address can be curated (no query string, no documents or drives)." });
    try {
      const before = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url))?.status ?? null;
      // Curating a page that is already cached pins it now; one that is
      // not cached waits for a warm.
      const row = status === "curated" ? await cacheGetUrlRow(url) : null;
      const pin = row && cardFrom(row.recipe, "curated", undefined) ? row.recipe : undefined;
      await upsertEntry(url, status as EntryStatus, typeof note === "string" ? note.slice(0, 300) : null, pin);
      await audit(req, before, status, url);
      clearReelMemo();
      return res.json({ ok: true, url, status, pinned: !!pin, cached: !!row });
    } catch (e) {
      if (isMissingTable(e)) return schemaBehind(res);
      console.error("[admin:reel:put]", (e as Error).message);
      return res.status(500).json({ error: "Could not save that." });
    }
  });

  router.delete("/reel", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const url = typeof req.query.url === "string" ? req.query.url : "";
    if (!urlKeyOf(url)) return res.status(400).json({ error: "Send ?url=" });
    try {
      const before = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url))?.status ?? null;
      const removed = await deleteEntry(url);
      if (removed) await audit(req, before, "removed", url);
      clearReelMemo();
      return res.json({ ok: true, removed });
    } catch (e) {
      if (isMissingTable(e)) return schemaBehind(res);
      console.error("[admin:reel:delete]", (e as Error).message);
      return res.status(500).json({ error: "Could not remove that." });
    }
  });

  router.post("/reel/warm", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { url, write, refresh, note } = req.body ?? {};
    if (typeof url !== "string" || !urlKeyOf(url)) return res.status(400).json({ error: "Send a url." });
    const doWrite = write === true;
    const doRefresh = refresh === true;
    if (!surfaceableUrl(url)) return res.json({ url, status: "not_public", note: "A query string, a document or drive host, or an IP address keeps a page out of the reel." });

    const row = await cacheGetUrlRow(url);
    const report = (extra: Record<string, unknown>) => res.json({ url, write: doWrite, ...extra });

    const describe = (recipe: unknown) => {
      const card = cardFrom(recipe as never, "curated", undefined);
      return card ? { title: card.title, site: card.site, totalMinutes: card.totalMinutes, mealType: card.mealType, clean: true } : { clean: false };
    };

    // Already cached, and not asked to refresh: free, and says what it predates.
    if (row && !(doWrite && doRefresh)) {
      const flags = staleFlags(row.recipe, !!(await extractionOriginal(row.hash, "page").catch(() => null)));
      const info = describe(row.recipe);
      let photo: ReelPhotoOutcome | undefined;
      if (doWrite && info.clean) {
        try {
          const before = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url))?.status ?? null;
          await upsertEntry(url, "curated", typeof note === "string" ? note : null, row.recipe);
          await audit(req, before, "curated", `${url} (cached, pinned)`);
        } catch (e) {
          if (isMissingTable(e)) return schemaBehind(res);
          throw e;
        }
        // The card's picture: no model call, so a cached page stays $0.
        photo = await storeReelPhoto(urlKeyOf(url)!, pageImageOf(row.recipe));
        clearReelMemo();
      }
      return report({
        status: "cached",
        estCostUsd: 0,
        flags,
        needsRefresh: flags.length > 0,
        ...info,
        curated: doWrite && info.clean,
        ...(photo ? { photo } : {}),
      });
    }
    if (!row && !doWrite) return report({ status: "would_extract", estCostUsd: null });

    // A model call: uncached with write, or a named refresh.
    const started = Date.now();
    let usage: CallUsage | undefined;
    try {
      if (row) await cacheDropUrl(url);
      const read = await readAtUrl(url);
      usage = read.usage;
      await cacheSetUrl(url, read.recipe);
      await keepOriginal(urlHash(url), read.original);
      const info = describe(read.recipe);
      const status = row ? "refreshed" : "extracted";
      recordExtraction({ source: "warmup", cached: false, via: read.via, attempts: read.attempts, repaired: read.repaired.length, host: hostOf(url), ok: true, ms: Date.now() - started, usage });
      let curated = false;
      let photo: ReelPhotoOutcome | undefined;
      if (info.clean) {
        try {
          const before = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url))?.status ?? null;
          await upsertEntry(url, "curated", typeof note === "string" ? note : null, read.recipe);
          curated = true;
          await audit(req, before, "curated", `${url} (${status}, est $${estimateCostUsd(usage).toFixed(4)})`);
        } catch (e) {
          if (!isMissingTable(e)) throw e;
        }
        photo = await storeReelPhoto(urlKeyOf(url)!, pageImageOf(read.recipe));
        clearReelMemo();
      }
      return report({ status, ms: Date.now() - started, estCostUsd: estimateCostUsd(usage), flags: [], ...info, curated, ...(photo ? { photo } : {}) });
    } catch (e) {
      usage = usage ?? (e as { usage?: CallUsage }).usage;
      recordExtraction({ source: "warmup", cached: false, host: hostOf(url), ok: false, ms: Date.now() - started, usage: usage ?? null });
      return report({
        status: "failed",
        ms: Date.now() - started,
        estCostUsd: usage ? estimateCostUsd(usage) : null,
        error: (e as Error).message,
        note: row ? "The cached copy was dropped before the re-read; a pinned copy, if any, still serves the reel." : undefined,
      });
    }
  });
}
