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
import { extractionEvents } from "../../shared/schema";
import { needsDatabase } from "./testdb";
import { hostOf, recordExtraction } from "./extractionLog";

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

  recordExtraction({
    source: "url",
    cached: false,
    via: "claude",
    attempts: 2,
    repaired: 3,
    host,
    ok: true,
    ms: 1234,
  });

  // Fire-and-forget by design, so the request path never waits on it — which
  // is exactly why the test has to.
  await new Promise((r) => setTimeout(r, 300));

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

  recordExtraction({ source: "url", cached: true, host, ok: true, ms: 8 });
  await new Promise((r) => setTimeout(r, 300));

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
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(extractionEvents);

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
  assert.doesNotThrow(() =>
    recordExtraction({ source: "url", cached: false, ok: null as never })
  );
  await new Promise((r) => setTimeout(r, 400));

  const after = await db.select({ n: sql<number>`count(*)::int` }).from(extractionEvents);
  assert.equal(after[0].n, before[0].n);
});

test("host is capped, so a hostile URL cannot write an unbounded row", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const db = getDb();
  // The stamp goes at the FRONT: the cap truncates the tail, so a unique
  // suffix would be the part that got cut off and every run would collide
  // with the last one's row.
  const stamp = `t${Date.now()}`;
  const like = `${stamp}-%`;
  recordExtraction({
    source: "url",
    cached: false,
    ok: true,
    host: `${stamp}-${"a".repeat(400)}.invalid`,
  });
  await new Promise((r) => setTimeout(r, 400));

  const rows = await db
    .select({ host: extractionEvents.host })
    .from(extractionEvents)
    .where(sql`${extractionEvents.host} like ${like}`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].host!.length <= 253, `host was ${rows[0].host!.length} chars`);

  await db.delete(extractionEvents).where(sql`${extractionEvents.host} like ${like}`);
});
