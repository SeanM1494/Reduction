/**
 * server/scripts/backfillUrlKey.ts — one-off, run deliberately.
 *
 *   DATABASE_URL=... npm run db:backfill-url-key -- --dry-run
 *   DATABASE_URL=... npm run db:backfill-url-key
 *
 * WHY THIS IS A SCRIPT AND NOT AN UPDATE STATEMENT.
 *
 * `url_key` is `sha256("urlkey:" + normalizeUrl(raw))`, and `normalizeUrl`
 * lowercases a host, strips `www.`, folds a trailing slash, deletes an
 * explicit deny-list of tracking parameters and re-sorts the rest. That is
 * not a SQL expression anybody should write twice — and writing it twice is
 * exactly the bug it would introduce, because the copy in SQL would drift
 * from the copy the server uses and rows would be keyed under something no
 * lookup ever computes. So the real function is imported and run.
 *
 * WHAT IT READS. The raw URL is already in the row: both extraction paths set
 * `recipe.sourceUrl = url` before caching, so `recipe->>'sourceUrl'` is the
 * exact string the `hash` was computed from. Rows without one are text and
 * file extractions, which have no URL and are skipped.
 *
 * SAFE TO RE-RUN AND SAFE TO SKIP. Nothing depends on this: `cacheGetUrl`
 * tries the exact key first, so an un-backfilled row still serves every
 * request it served yesterday. All this does is let those rows also answer to
 * a normalised alias, which is a hit-rate improvement on history, not a
 * correctness fix. It only ever writes rows whose `url_key` is null.
 */

import { isNull, and, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { extractionCache } from "../../shared/schema";
import { urlKeyOf } from "../lib/urlKey";

const DRY = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const db = getDb();

  const rows = await db
    .select({
      hash: extractionCache.hash,
      sourceUrl: sql<string | null>`${extractionCache.recipe} ->> 'sourceUrl'`,
    })
    .from(extractionCache)
    .where(isNull(extractionCache.urlKey));

  let updated = 0;
  let noUrl = 0;
  let unparseable = 0;
  const collisions = new Map<string, string[]>();

  for (const row of rows) {
    if (!row.sourceUrl) {
      noUrl++;
      continue;
    }
    const key = urlKeyOf(row.sourceUrl);
    if (!key) {
      unparseable++;
      continue;
    }
    collisions.set(key, [...(collisions.get(key) ?? []), row.sourceUrl]);
    if (!DRY) {
      await db
        .update(extractionCache)
        .set({ urlKey: key })
        .where(and(isNull(extractionCache.urlKey), sql`${extractionCache.hash} = ${row.hash}`));
    }
    updated++;
  }

  console.log(`${DRY ? "[dry run] " : ""}rows missing url_key : ${rows.length}`);
  console.log(`${DRY ? "[dry run] " : ""}  backfilled          : ${updated}`);
  console.log(`${DRY ? "[dry run] " : ""}  no sourceUrl (text/file): ${noUrl}`);
  console.log(`${DRY ? "[dry run] " : ""}  unparseable url     : ${unparseable}`);

  // The interesting output. Two rows folding to one alias means two raw URLs
  // this run considers the same page — which is the whole point, and also the
  // one thing worth eyeballing before trusting it, because a fold that is
  // wrong serves somebody the wrong recipe.
  const folded = [...collisions.entries()].filter(([, urls]) => urls.length > 1);
  if (folded.length) {
    console.log(`\n${folded.length} alias group(s) with more than one raw URL:`);
    for (const [, urls] of folded) {
      console.log("  -");
      for (const u of urls) console.log(`    ${u}`);
    }
    console.log(
      "\nEach group above will now answer as one cached page. Check they really are."
    );
  } else {
    console.log("\nNo two rows folded together.");
  }

  // Rows already carrying a key, for a sense of how much history is left.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(extractionCache)
    .where(isNotNull(extractionCache.urlKey));
  console.log(`\nrows with a url_key now: ${count}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
