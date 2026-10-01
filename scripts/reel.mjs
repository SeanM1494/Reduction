#!/usr/bin/env node
/**
 * scripts/reel.mjs — the owner's controls for the starter reel, run from the
 * Replit shell against the DEPLOYMENT (never the database directly). It
 * calls the admin routes (artifacts/api-server/src/routes/adminReel.ts)
 * with ADMIN_SECRET, so every change happens on the server, through the
 * same code as the app's own extraction, audited in admin_events.
 *
 *   node scripts/reel.mjs preview
 *       The dry run: what a stranger's reel contains now (title, site,
 *       data-backed or curated, usage line) and why other pages were left
 *       out, as counts. No accounts, no emails.
 *
 *   node scripts/reel.mjs warm [list]
 *       Report only (the default). The list defaults to ~/workspace/reel-urls.txt
 *       — the repo root on Replit. Keep lists THERE: Replit clears the home
 *       folder (/home/runner) between sessions and keeps only ~/workspace,
 *       which is how ~/reel-urls.txt vanished on Oct 1. reel-*.txt at the
 *       repo root is gitignored (working data). One URL per line; # comments and blank
 *       lines ignored. Each URL: cached already ($0), would extract, or not
 *       public; and for a cached page, what it predates (step order,
 *       picture, original wording).
 *
 *       With --write, each curated page's card picture is stored too (the
 *       page's own image, fetched by the server; no model call).
 *
 *   node scripts/reel.mjs warm [list] --write
 *       Extracts each URL that is NOT cached, once, and adds every clean
 *       page to the curated list with a pinned copy. Cached pages are
 *       curated as they are — never re-read.
 *
 *   node scripts/reel.mjs warm [list] --write --refresh <url> [--refresh <url> ...]
 *       Also re-reads the named cached pages (about 6-7 cents each). Only
 *       the URLs named after --refresh are re-read.
 *
 *   node scripts/reel.mjs hide <url>      never offer this page
 *   node scripts/reel.mjs unhide <url>    take it off the list
 *
 * Needs PUBLIC_BASE_URL (the deployment's address) and ADMIN_SECRET in the
 * environment — both are in the Replit workspace's secrets.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repo root — ~/workspace on Replit, the one folder Replit keeps.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LIST = join(REPO, "reel-urls.txt");
const shown = (p) => (p.startsWith(REPO + "/") ? `~/workspace/${p.slice(REPO.length + 1)}` : p);

/** One URL per line; # comments and blank lines ignored. A missing file is
 *  a clear refusal naming the path tried and where lists belong. */
function readList(path) {
  if (!existsSync(path)) {
    console.error(`reel: no URL list at ${shown(path)}.`);
    console.error("  Keep lists in ~/workspace: Replit clears your home folder (/home/runner) between sessions and keeps only ~/workspace.");
    console.error(`  Create it, one URL per line (# starts a comment):`);
    // Suggest a place that survives: inside ~/workspace, under the same name.
    const keep = path.startsWith(REPO + "/") ? path : join(REPO, basename(path));
    console.error(`    cat > ${shown(keep)} <<'EOF'`);
    console.error("    https://example.com/a-recipe");
    console.error("    EOF");
    process.exit(1);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const secret = process.env.ADMIN_SECRET || "";
if (!base || !secret) {
  console.error("reel: PUBLIC_BASE_URL and ADMIN_SECRET must be set (Replit › Secrets).");
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { "x-admin-secret": secret, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? ""}`.trim());
  return json;
}

const PHOTO_WORDS = {
  stored: "stored",
  kept: "already stored",
  none: "the page names none (the card shows its meal-type art)",
  failed: "could not be fetched (the card shows its meal-type art; the server log says why)",
  no_table: 'no reel_photos table yet (README "Starter recipes reel")',
};
const money = (v) => (v === null || v === undefined ? "?" : `$${Number(v).toFixed(3)}`);
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "preview") {
  const { entries, preview } = await call("GET", "/reel");
  const min = preview.minCards ?? 3;
  console.log(
    `Heading: ${preview.cards.length ? preview.heading : preview.withheld?.length ? `(reel hidden: only ${preview.withheld.length} card(s) qualify, the minimum is ${min})` : "(reel hidden: nothing qualifies)"}`
  );
  preview.cards.forEach((c, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${c.kind === "data" ? "data   " : "curated"}] ${c.title} — ${c.site}${c.totalMinutes ? ` · ${c.totalMinutes} min` : ""}${c.usage ? ` · ${c.usage}` : ""}${c.photo ? "" : " · no picture"}`);
  });
  if (preview.withheld?.length) {
    console.log("Waiting for the minimum:");
    for (const c of preview.withheld) console.log(`    [${c.kind === "data" ? "data   " : "curated"}] ${c.title} — ${c.site}`);
  }
  const x = preview.excluded;
  console.log(
    `Left out: ${x.belowMinimums} below the minimums, ${x.notCached} not cached, ${x.notClean} not clean, ${x.hidden} hidden, ${x.noPicture ?? 0} no stored picture.`
  );
  if (preview.missingPicture?.length) {
    console.log("No stored picture (a card is offered only with its page's own picture):");
    for (const m of preview.missingPicture) console.log(`    [${m.kind === "data" ? "data   " : "curated"}] ${m.title} — ${m.site}\n        ${m.url}`);
  }
  if (preview.restored) console.log(`Restored ${preview.restored} curated page(s) to the cache from their pinned copies.`);
  console.log(`Owner list: ${entries.filter((e) => e.status === "curated").length} curated, ${entries.filter((e) => e.status === "hidden").length} hidden.`);
} else if (cmd === "warm") {
  // The list is the first argument that is neither a flag nor a flag's value.
  const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--refresh");
  const file = positional[0] ? resolve(positional[0]) : DEFAULT_LIST;
  const write = rest.includes("--write");
  const refresh = new Set(rest.flatMap((a, i) => (a === "--refresh" ? [rest[i + 1]] : [])).filter(Boolean));
  if (refresh.size && !write) {
    console.error("reel: --refresh re-reads pages, so it needs --write too.");
    process.exit(1);
  }
  const urls = readList(file);
  console.log(`${write ? "WRITING" : "Report only"} — ${urls.length} URL(s) from ${shown(file)} against ${base}\n`);
  let spent = 0;
  const flagged = [];
  for (const url of urls) {
    try {
      const r = await call("POST", "/reel/warm", { url, write, refresh: refresh.has(url) });
      spent += Number(r.estCostUsd ?? 0);
      const what = r.title ? `${r.title} — ${r.site}${r.totalMinutes ? ` · ${r.totalMinutes} min` : ""}` : r.clean === false ? "(not clean: will not be offered)" : "";
      const time = r.ms ? ` ${(r.ms / 1000).toFixed(1)}s` : "";
      console.log(`${r.status.padEnd(13)} ${money(r.estCostUsd).padStart(7)}${time}  ${url}`);
      if (what) console.log(`${"".padEnd(22)}${what}`);
      if (r.flags?.length) {
        console.log(`${"".padEnd(22)}predates: ${r.flags.join(", ")}`);
        flagged.push(url);
      }
      if (r.photo) console.log(`${"".padEnd(22)}picture: ${PHOTO_WORDS[r.photo] ?? r.photo}`);
      if (r.error) console.log(`${"".padEnd(22)}error: ${r.error}`);
    } catch (e) {
      console.log(`error         ${url}\n${"".padEnd(22)}${e.message}`);
    }
  }
  console.log(`\nEstimated spend this run: ${money(spent)}`);
  const unrefreshed = flagged.filter((u) => !refresh.has(u));
  if (unrefreshed.length) {
    console.log(`\n${unrefreshed.length} cached page(s) predate a feature. To re-read one (about 6-7 cents each):`);
    const listArg = file === DEFAULT_LIST ? "" : ` ${shown(file)}`;
    for (const u of unrefreshed) console.log(`  node scripts/reel.mjs warm${listArg} --write --refresh ${u}`);
  }
} else if (cmd === "hide" || cmd === "unhide") {
  const url = rest[0];
  if (!url) {
    console.error(`reel: ${cmd} needs a URL.`);
    process.exit(1);
  }
  const r = cmd === "hide" ? await call("PUT", "/reel", { url, status: "hidden" }) : await call("DELETE", `/reel?url=${encodeURIComponent(url)}`);
  console.log(JSON.stringify(r));
} else {
  console.error("usage: node scripts/reel.mjs preview | warm [list, default ~/workspace/reel-urls.txt] [--write] [--refresh <url>]... | hide <url> | unhide <url>");
  process.exit(1);
}
