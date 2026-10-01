/**
 * routes/adminReel.ts — the owner's controls for the starter reel, behind
 * the admin secret (mounted on adminRouter at /api/admin/reel):
 *
 *   GET    /reel          the list (curated / hidden) and a PREVIEW of the
 *                         reel as a stranger would get it now — the dry run,
 *                         with what was left out and why: no stored picture
 *                         (named), and cards withheld below the minimum
 *   PUT    /reel          { url, status: "curated" | "hidden", note?, purge? } —
 *                         `purge: true` (hidden only) also DELETES the page's
 *                         stored picture; plain hide keeps it
 *   DELETE /reel?url=     takes a URL off the list
 *   POST   /reel/warm     { url, write?, refresh?, force?, note? } — one URL a call
 *
 * The curated list holds at most REEL.maxCurated (20): curating a 21st —
 * by PUT or by `warm --write` — is refused (409 / status "refused") before
 * anything is read or written. Entries already past the cap are kept.
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
 *
 * HOW A PAGE WAS READ (Oct 1, lib/readHistory.ts): every cached report says
 * whether the page came through our own fetch or the fallback, which never
 * records a picture — so a fallback page can never be in the reel. A named
 * refresh of such a page is REFUSED (status "refused", nothing dropped, $0)
 * unless the call also says `force: true`. An uncached page's report carries
 * an estimated cost from recent reads, the fallback's when the site's last
 * read went through it.
 *
 * A HIDDEN PAGE IS NEVER WARMED (Oct 1): a warm on it is refused before
 * anything is read, curated or stored, so neither a plain hide nor a purge
 * can be undone by a list that still names the page. Taking it off the
 * list (`unhide`) is the only way back. A purge is how a site's removal
 * request is answered: the row in reel_photos goes, the photo route answers
 * 404, and the purge has its own admin_events row (after = "purged").
 */

import type { Request, Response, Router } from "express";
import crypto from "node:crypto";
import { adminEvents } from "@workspace/db";
import { getDb } from "../db";
import { surfaceableUrl } from "../lib/searchLibrary";
import { urlKeyOf } from "../lib/urlKey";
import { cardFrom, reelMaxCurated, reelMinCards, staleFlags } from "../lib/reel";
import { buildReel, curatedCapRefusal, deleteEntry, isMissingTable, loadEntries, upsertEntry, type EntryStatus } from "../lib/reelStore";
import { cacheDropUrl, cacheGetUrlRow, cacheSetUrl, keepOriginal } from "./recipes";
import { clearReelMemo } from "./reel";
import { readRecipeAtUrl } from "../lib/readRecipe";
import { extractionOriginal } from "../lib/original";
import { recordExtraction, hostOf } from "../lib/extractionLog";
import { estimateCostUsd } from "../lib/extractionCost";
import { clientKey } from "../lib/clientAddress";
import { pageImageOf, purgeReelPhoto, storeReelPhoto, type ReelPhotoOutcome } from "../lib/reelPhotos";
import { lastHostRead, readPathNote, readPathOf, typicalReadCost } from "../lib/readHistory";
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
        preview: { ...preview, minCards: reelMinCards(), maxCurated: reelMaxCurated() },
      });
    } catch (e) {
      console.error("[admin:reel]", (e as Error).message);
      return res.status(500).json({ error: "Could not build the reel." });
    }
  });

  router.put("/reel", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { url, status, note, purge } = req.body ?? {};
    if (typeof url !== "string" || !urlKeyOf(url)) return res.status(400).json({ error: "Send a url." });
    if (status !== "curated" && status !== "hidden") return res.status(400).json({ error: 'status is "curated" or "hidden".' });
    if (purge === true && status !== "hidden") return res.status(400).json({ error: "Only a hide can purge: send status \"hidden\" with purge." });
    if (status === "curated" && !surfaceableUrl(url))
      return res.status(422).json({ error: "Only a public-looking address can be curated (no query string, no documents or drives)." });
    try {
      if (status === "curated") {
        const full = await curatedCapRefusal(url);
        if (full) return res.status(409).json({ error: full.reason, code: "curated_full", curated: full.count, max: full.cap });
      }
      const before = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url))?.status ?? null;
      // Curating a page that is already cached pins it now; one that is
      // not cached waits for a warm.
      const row = status === "curated" ? await cacheGetUrlRow(url) : null;
      const pin = row && cardFrom(row.recipe, "curated", undefined) ? row.recipe : undefined;
      await upsertEntry(url, status as EntryStatus, typeof note === "string" ? note.slice(0, 300) : null, pin);
      await audit(req, before, status, url);
      // A purge answers a removal request (terms.html): our stored copy of
      // the page's picture goes, and the purge is audited on its own row,
      // whether or not a picture was there to delete.
      let pictureDeleted: boolean | undefined;
      if (purge === true) {
        pictureDeleted = await purgeReelPhoto(urlKeyOf(url)!);
        await audit(req, "hidden", "purged", `${url} (${pictureDeleted ? "stored picture deleted" : "no stored picture"})`);
      }
      clearReelMemo();
      return res.json({ ok: true, url, status, pinned: !!pin, cached: !!row, ...(purge === true ? { purged: true, pictureDeleted } : {}) });
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
    const { url, write, refresh, force, note } = req.body ?? {};
    if (typeof url !== "string" || !urlKeyOf(url)) return res.status(400).json({ error: "Send a url." });
    const doWrite = write === true;
    const doRefresh = refresh === true;
    if (!surfaceableUrl(url)) return res.json({ url, status: "not_public", note: "A query string, a document or drive host, or an IP address keeps a page out of the reel." });

    const report = (extra: Record<string, unknown>) => res.json({ url, write: doWrite, ...extra });
    // Hidden (and so purged) pages first: nothing below may read, curate or
    // store a picture for one.
    const listed = (await loadEntries()).find((e) => e.urlKey === urlKeyOf(url));
    if (listed?.status === "hidden")
      return report({
        status: "refused",
        estCostUsd: 0,
        reason: "This page is hidden, so it is never warmed: nothing was read, curated or stored. Run `node scripts/reel.mjs unhide <url>` first if it should come back.",
      });

    // A write curates, so a full list refuses it before any read or spend.
    // A report still reports.
    if (doWrite) {
      const full = await curatedCapRefusal(url);
      if (full) return report({ status: "refused", estCostUsd: 0, reason: full.reason, curatedCount: full.count, maxCurated: full.cap });
    }

    const row = await cacheGetUrlRow(url);

    const describe = (recipe: unknown) => {
      const card = cardFrom(recipe as never, "curated", undefined);
      return card ? { title: card.title, site: card.site, totalMinutes: card.totalMinutes, mealType: card.mealType, clean: true } : { clean: false };
    };

    // How this page (or, failing that, its site) was last read.
    const hostLast = await lastHostRead(hostOf(url));
    const readOf = (recipe: unknown) => {
      const r = readPathOf(recipe, hostLast);
      const n = readPathNote(r.path, r.basis);
      return { path: r.path, basis: r.basis, note: n.note, refuseRefresh: n.refuseRefresh, lastSiteRead: hostLast?.at ?? null };
    };

    // A named refresh of a page read through the fallback buys nothing: the
    // fallback never records a picture. Refused, out loud, unless forced.
    if (row && doWrite && doRefresh && force !== true) {
      const read = readOf(row.recipe);
      if (read.refuseRefresh)
        return report({
          status: "refused",
          estCostUsd: 0,
          read,
          reason: "This page was read through the fallback, which never records a picture, so a re-read cannot get it into the reel. Nothing was changed. Re-run with --force to re-read it anyway.",
        });
    }

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
        read: readOf(row.recipe),
        flags,
        needsRefresh: flags.length > 0,
        ...info,
        curated: doWrite && info.clean,
        ...(photo ? { photo } : {}),
      });
    }
    if (!row && !doWrite) {
      // What reading it would likely cost, from recent reads: the fallback's
      // figure when this site's last read went through it (and then, no
      // picture to expect).
      const read = readOf(null);
      const estimate = await typicalReadCost(read.path === "fallback" ? "claude" : "self");
      return report({
        status: "would_extract",
        estCostUsd: estimate,
        estimateBasis: estimate === null ? "no reads on record yet" : read.path === "fallback" ? "recent fallback reads" : "recent reads by our own fetch",
        read: read.path === "fallback" ? { ...read, note: "this site was last read through the fallback: expect no picture, so it cannot join the reel" } : read,
      });
    }

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
      const readNow = read.via === "claude" ? { path: "fallback", note: "read through the fallback: no picture can be stored" } : { path: "self", note: "read by our own fetch" };
      return report({ status, ms: Date.now() - started, estCostUsd: estimateCostUsd(usage), flags: [], read: readNow, ...info, curated, ...(photo ? { photo } : {}) });
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
