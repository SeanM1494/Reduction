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
 *   node scripts/reel.mjs warm urls.txt
 *       Report only (the default). One URL per line; # comments and blank
 *       lines ignored. Each URL: cached already ($0), would extract, or not
 *       public; and for a cached page, what it predates (step order,
 *       picture, original wording).
 *
 *   node scripts/reel.mjs warm urls.txt --write
 *       Extracts each URL that is NOT cached, once, and adds every clean
 *       page to the curated list with a pinned copy. Cached pages are
 *       curated as they are — never re-read.
 *
 *   node scripts/reel.mjs warm urls.txt --write --refresh <url> [--refresh <url> ...]
 *       Also re-reads the named cached pages (about 6-7 cents each). Only
 *       the URLs named after --refresh are re-read.
 *
 *   node scripts/reel.mjs hide <url>      never offer this page
 *   node scripts/reel.mjs unhide <url>    take it off the list
 *
 * Needs PUBLIC_BASE_URL (the deployment's address) and ADMIN_SECRET in the
 * environment — both are in the Replit workspace's secrets.
 */

import { readFileSync } from "node:fs";

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

const money = (v) => (v === null || v === undefined ? "?" : `$${Number(v).toFixed(3)}`);
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "preview") {
  const { entries, preview } = await call("GET", "/reel");
  console.log(`Heading: ${preview.cards.length ? preview.heading : "(reel hidden: nothing qualifies)"}`);
  preview.cards.forEach((c, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${c.kind === "data" ? "data   " : "curated"}] ${c.title} — ${c.site}${c.totalMinutes ? ` · ${c.totalMinutes} min` : ""}${c.usage ? ` · ${c.usage}` : ""}`);
  });
  const x = preview.excluded;
  console.log(`Left out: ${x.belowMinimums} below the minimums, ${x.notCached} not cached, ${x.notClean} not clean, ${x.hidden} hidden.`);
  if (preview.restored) console.log(`Restored ${preview.restored} curated page(s) to the cache from their pinned copies.`);
  console.log(`Owner list: ${entries.filter((e) => e.status === "curated").length} curated, ${entries.filter((e) => e.status === "hidden").length} hidden.`);
} else if (cmd === "warm") {
  const file = rest[0];
  if (!file) {
    console.error("reel: warm needs a file of URLs.");
    process.exit(1);
  }
  const write = rest.includes("--write");
  const refresh = new Set(rest.flatMap((a, i) => (a === "--refresh" ? [rest[i + 1]] : [])).filter(Boolean));
  if (refresh.size && !write) {
    console.error("reel: --refresh re-reads pages, so it needs --write too.");
    process.exit(1);
  }
  const urls = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  console.log(`${write ? "WRITING" : "Report only"} — ${urls.length} URL(s) against ${base}\n`);
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
      if (r.error) console.log(`${"".padEnd(22)}error: ${r.error}`);
    } catch (e) {
      console.log(`error         ${url}\n${"".padEnd(22)}${e.message}`);
    }
  }
  console.log(`\nEstimated spend this run: ${money(spent)}`);
  const unrefreshed = flagged.filter((u) => !refresh.has(u));
  if (unrefreshed.length) {
    console.log(`\n${unrefreshed.length} cached page(s) predate a feature. To re-read one (about 6-7 cents each):`);
    for (const u of unrefreshed) console.log(`  node scripts/reel.mjs warm ${file} --write --refresh ${u}`);
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
  console.error("usage: node scripts/reel.mjs preview | warm <file> [--write] [--refresh <url>]... | hide <url> | unhide <url>");
  process.exit(1);
}
