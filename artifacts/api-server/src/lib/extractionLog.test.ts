/**
 * server/lib/extractionLog.test.ts
 *
 * `hostOf` needs no database. `recordExtraction` does, and the property worth
 * asserting against a real one is the one that would hurt: it must not be
 * possible for this to fail a request. A stub cannot prove that, because the
 * failure mode is a real insert erroring on a real table.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { extractionEvents } from "@workspace/db";
import { needsDatabase } from "./testdb";
import { eventRow, hostOf, isMissingColumn, recordExtraction, writeEvent } from "./extractionLog";
import { emptyUsage } from "./extractionConfig";

test("hostOf keeps the site and drops everything that identifies a page", () => {
  assert.equal(hostOf("https://www.seriouseats.com/recipes/2015/chili"), "seriouseats.com");
  assert.equal(hostOf("http://SeriousEats.com/x?utm_source=y#z"), "seriouseats.com");
  // A subdomain that is not www is a different site as far as "which sites
  // are expensive" is concerned, so it is kept.
  assert.equal(hostOf("https://blog.example.com/x"), "blog.example.com");
  // No path, ever — that is the line between an operations table and a record
  // of what somebody was cooking.
  assert.ok(!hostOf("https://example.com/secret/path")!.includes("secret"));
});

test("hostOf returns null rather than throwing on anything unparseable", () => {
  for (const bad of ["", "not a url", "/relative", "example.com/no-scheme"]) {
    assert.equal(hostOf(bad), null);
  }
});

test("recordExtraction writes one row and never throws", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  const host = `logtest-${Date.now()}.invalid`;

  await recordExtraction({
    source: "url",
    cached: false,
    via: "claude",
    attempts: 2,
    repaired: 3,
    host,
    ok: true,
    ms: 1234,
  });

  const rows = await db
    .select()
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} = ${host}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].via, "claude");
  assert.equal(rows[0].attempts, 2);
  assert.equal(rows[0].repaired, 3);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].ms, 1234);
  assert.ok(rows[0].at);

  await db.delete(extractionEvents).where(sql`${extractionEvents.host} = ${host}`);
});

test("a cache hit records no via, which is what makes the fraction correct", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  const host = `logtest-cached-${Date.now()}.invalid`;

  await recordExtraction({ source: "url", cached: true, host, ok: true, ms: 8 });

  const [row] = await db
    .select()
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} = ${host}`);
  assert.equal(row.cached, true);
  assert.equal(row.via, null);
  assert.equal(row.attempts, null);

  // The query this table exists for: the denominator is uncached rows only,
  // so a hit contributing a `via` would inflate whichever path it landed on.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} = ${host} and not ${extractionEvents.cached}`);
  assert.equal(n, 0);

  await db.delete(extractionEvents).where(sql`${extractionEvents.host} = ${host}`);
});

test("a failing write is swallowed, not thrown, and leaves nothing behind", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  const host = `logtest-fail-${Date.now()}.invalid`;

  // The realistic version of this is the migration not having been run yet:
  // the insert fails and the extraction it was describing must still have
  // succeeded. A NOT NULL violation reaches the same catch as a missing
  // relation.
  //
  // The first attempt at this test used a 100,000-character `source`, on the
  // assumption a text column would reject it. Postgres text has no length
  // limit, so the insert SUCCEEDED — the test asserted nothing and left a
  // 100KB row behind on every run. Hence `host` being capped in
  // extractionLog.ts, and hence this test counting rows.
  //
  // It counts ITS OWN rows, by a host nobody else writes. It used to count
  // the whole table before and after, and node --test runs the other suites
  // in parallel processes against the same database — costs.db.test.ts
  // inserts a batch of extraction_events in that window, and the count came
  // back 375 against 21 (Oct 1, 2 runs in 15 beside those suites).
  let written!: Promise<void>;
  assert.doesNotThrow(() => {
    written = recordExtraction({ source: "url", cached: false, host, ok: null as never });
  });
  await written;

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} = ${host}`);
  assert.equal(n, 0);
});

test("host is capped, so a hostile URL cannot write an unbounded row", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  // The stamp goes at the FRONT: the cap truncates the tail, so a unique
  // suffix would be the part that got cut off and every run would collide
  // with the last one's row.
  const stamp = `t${Date.now()}`;
  const like = `${stamp}-%`;
  await recordExtraction({
    source: "url",
    cached: false,
    ok: true,
    host: `${stamp}-${"a".repeat(400)}.invalid`,
  });

  const rows = await db
    .select({ host: extractionEvents.host })
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} like ${like}`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].host!.length <= 253, `host was ${rows[0].host!.length} chars`);

  await db.delete(extractionEvents).where(sql`${extractionEvents.host} like ${like}`);
});

// ---- Cost (Sep 30) ---------------------------------------------------------

const usage = (over: Partial<ReturnType<typeof emptyUsage>> = {}) => ({ ...emptyUsage(), ...over });

test("a cache hit is logged at zero cost and zero tokens, whatever usage it is handed", () => {
  const row = eventRow({ source: "url", cached: true, ok: true, usage: usage({ inputTokens: 999, outputTokens: 999 }) });
  assert.deepEqual([row.inputTokens, row.outputTokens, row.estCostUsd], [0, 0, "0"]);
});

test("a fresh extraction is priced from its usage: every prompt token, and the estimate", () => {
  const row = eventRow({
    source: "text",
    cached: false,
    ok: true,
    userId: "u-1",
    usage: usage({ inputTokens: 6000, outputTokens: 2000, cacheReadTokens: 1000 }),
  });
  assert.equal(row.inputTokens, 7000, "cached and uncached prompt tokens together");
  assert.equal(row.outputTokens, 2000);
  assert.equal(row.estCostUsd, "0.032200", "6000x$2 + 2000x$10 + 1000x$0.20, per million");
  assert.equal(row.userId, "u-1");
});

test("a fresh attempt with no usage is UNKNOWN cost, not free; a trial has no user", () => {
  const row = eventRow({ source: "url", cached: false, ok: false });
  assert.deepEqual([row.inputTokens, row.outputTokens, row.estCostUsd, row.userId], [null, null, null, null]);
});

test("the write falls back to the old columns when the cost columns are missing, and only then", async () => {
  const row = eventRow({ source: "url", cached: false, ok: true, usage: usage({ inputTokens: 1, outputTokens: 1 }) });
  const calls: string[] = [];
  const missing = Object.assign(new Error('column "user_id" does not exist'), { code: "42703" });
  assert.equal(
    await writeEvent(row, async () => { calls.push("full"); throw missing; }, async () => { calls.push("legacy"); }),
    "legacy"
  );
  assert.deepEqual(calls, ["full", "legacy"]);
  // Wrapped the way Drizzle wraps a driver error.
  assert.equal(isMissingColumn({ cause: { code: "42703" } }), true);
  // Anything else is not papered over.
  const other = Object.assign(new Error("relation does not exist"), { code: "42P01" });
  await assert.rejects(writeEvent(row, async () => { throw other; }, async () => assert.fail("no fallback")), /relation/);
  assert.equal(await writeEvent(row, async () => {}, async () => assert.fail("no fallback")), "full");
});

test("recordExtraction writes the account and the estimated cost", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  const host = `costtest-${Date.now()}.invalid`;
  // Both in flight at once, as two requests would be — so the ids may land in
  // either order, and the rows are compared fresh-first rather than by id.
  await Promise.all([
    recordExtraction({ source: "url", cached: false, via: "self", host, ok: true, ms: 5, userId: "cost-user", usage: usage({ inputTokens: 5000, outputTokens: 1000 }) }),
    recordExtraction({ source: "url", cached: true, via: "self", host, ok: true, ms: 1, userId: "cost-user" }),
  ]);
  const rows = await db.select().from(extractionEvents).where(sql`${extractionEvents.host} = ${host}`).orderBy(extractionEvents.cached);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.cached, r.userId, r.inputTokens, r.outputTokens, Number(r.estCostUsd)]), [
    [false, "cost-user", 5000, 1000, 0.02],
    [true, "cost-user", 0, 0, 0],
  ]);
  await db.delete(extractionEvents).where(sql`${extractionEvents.host} = ${host}`);
});
