/**
 * lib/crashReports.ts — storing and reading the crash reports the phone and
 * the website send (Oct 1, POST /api/crash).
 *
 * A REPORT NAMES NO ONE. It is scrubbed on the device and again by the
 * route (recipe-model `crashReport.ts`), and the table has no column for an
 * account, a device or an address — the route does not even read the
 * session. privacy.html says so; a column that identified anyone would break
 * the policy.
 *
 * IT MUST NEVER FAIL A REQUEST, and never become a second error: every write
 * swallows its error, and a missing table (hand-run DDL, README "Crash
 * reports") warns once per process and stores nothing.
 *
 * Two brakes on volume, neither in process memory alone: the route's
 * per-client hourly brake (in memory — a miss across instances lets a few
 * more through, the harmless direction), and a DAILY_CAP checked in the
 * insert itself, so a script cannot fill the table however many instances
 * it reaches. Rows older than RETENTION_DAYS are pruned on the way in, at
 * most once an hour per process.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { crashFingerprintSource, type CrashReport } from "@workspace/recipe-model/crashReport";
import { getDb } from "../db";

export const DAILY_CAP = 5000;
export const RETENTION_DAYS = 90;
const PRUNE_EVERY_MS = 3_600_000;

let warned = false;
let lastPrune = 0;

export const crashFingerprint = (r: CrashReport): string =>
  createHash("sha256").update(crashFingerprintSource(r)).digest("hex").slice(0, 16);

function warnOnce(e: unknown): void {
  if (warned) return;
  warned = true;
  const err = e as Error & { cause?: Error };
  console.warn('[crash] not storing reports (README "Crash reports"):', (err.cause ?? err).message);
}

/**
 * Stores one report unless today's cap is reached (`cap` is a parameter only
 * so a test can reach it). Resolves to whether a row
 * was written; the route calls it with `void` and never waits.
 */
export async function recordCrash(r: CrashReport, cap: number = DAILY_CAP): Promise<boolean> {
  try {
    const db = getDb();
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      await db.execute(sql`delete from crash_reports where at < now() - make_interval(days => ${RETENTION_DAYS})`);
    }
    const res = (await db.execute(sql`
      insert into crash_reports
        (fingerprint, kind, platform, name, message, stack, route, app_version, runtime, update_id, channel, os_version)
      select ${crashFingerprint(r)}, ${r.kind}, ${r.platform}, ${r.name}, ${r.message}, ${r.stack.join("\n")},
             ${r.route}, ${r.appVersion}, ${r.runtime}, ${r.updateId}, ${r.channel}, ${r.osVersion}
       where (select count(*) from crash_reports where at >= date_trunc('day', now())) < ${cap}`)) as unknown as {
      rowCount: number | null;
    };
    const wrote = (res.rowCount ?? 0) > 0;
    if (!wrote) console.warn(`[crash] daily cap of ${cap} reached; dropping reports until tomorrow (UTC)`);
    return wrote;
  } catch (e) {
    warnOnce(e);
    return false;
  }
}

export interface CrashGroup {
  fingerprint: string;
  count: number;
  firstAt: string;
  lastAt: string;
  kinds: string[];
  platforms: string[];
  appVersions: string[];
  updateIds: string[];
  routes: string[];
  /** The newest report in the group, whole. */
  latest: {
    name: string;
    message: string;
    stack: string[];
    route: string | null;
    appVersion: string | null;
    runtime: string | null;
    updateId: string | null;
    channel: string | null;
    osVersion: string | null;
  };
}

/** The last `days` days, grouped by fingerprint, the most frequent first. */
export async function readCrashes(days: number): Promise<{ days: number; total: number; groups: CrashGroup[] }> {
  const rows = ((await getDb().execute(sql`
    with recent as (
      select * from crash_reports where at >= now() - make_interval(days => ${days})
    ), latest as (
      select distinct on (fingerprint) * from recent order by fingerprint, at desc
    )
    select r.fingerprint,
           count(*)::int as count,
           min(r.at)::text as first_at,
           max(r.at)::text as last_at,
           array_agg(distinct r.kind) as kinds,
           array_agg(distinct r.platform) as platforms,
           array_remove(array_agg(distinct r.app_version), null) as app_versions,
           array_remove(array_agg(distinct r.update_id), null) as update_ids,
           array_remove(array_agg(distinct r.route), null) as routes,
           l.name, l.message, l.stack, l.route, l.app_version, l.runtime, l.update_id, l.channel, l.os_version
      from recent r join latest l using (fingerprint)
     group by r.fingerprint, l.name, l.message, l.stack, l.route, l.app_version, l.runtime, l.update_id, l.channel, l.os_version
     order by count(*) desc, max(r.at) desc
     limit 100`)) as unknown as { rows: Array<Record<string, unknown>> }).rows;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const groups: CrashGroup[] = rows.map((r) => ({
    fingerprint: String(r.fingerprint),
    count: Number(r.count),
    firstAt: String(r.first_at),
    lastAt: String(r.last_at),
    kinds: list(r.kinds),
    platforms: list(r.platforms),
    appVersions: list(r.app_versions),
    updateIds: list(r.update_ids),
    routes: list(r.routes),
    latest: {
      name: String(r.name),
      message: String(r.message),
      stack: String(r.stack ?? "").split("\n").filter(Boolean),
      route: str(r.route),
      appVersion: str(r.app_version),
      runtime: str(r.runtime),
      updateId: str(r.update_id),
      channel: str(r.channel),
      osVersion: str(r.os_version),
    },
  }));
  return { days, total: groups.reduce((n, g) => n + g.count, 0), groups };
}

export function resetCrashStateForTests(): void {
  warned = false;
  lastPrune = 0;
}
