/**
 * routes/adminDiagnostics.test.ts — the per-client key through real requests
 * (Sep 30): the TEMPORARY diagnostic, which may say whether the key anchored
 * and never show an address; the admin throttle, which now locks out one
 * client rather than everybody; and a guard that no route keys a brake on
 * `req.ip` again. No database: the admin guard reads only the secret.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http, { createServer, type Server } from "node:http";
import { adminRouter, resetAdminThrottle } from "./admin";
import { overLimit, resetRateLimitForTests } from "./recipes";
import { keyDigest, resetClientAddressForTests } from "../lib/clientAddress";

const SECRET = "test-admin-secret-ip-0123456789";
const EDGES = "34.111.179.208,34.117.33.233";
const CHAIN = "34.70.186.43, 34.111.179.208, 35.191.161.29,136.115.121.130";
let server: Server | null = null;
let port = 0;

async function listen(): Promise<number> {
  if (port) return port;
  const app = express();
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  return port;
}

after(() => server?.close());

/** http.request rather than fetch: an ARRAY value goes out as separate
 *  header lines, which fetch would merge before sending. */
async function get(secret: string | null, xff?: string | string[]): Promise<{ status: number; body: any; text: string }> {
  const p = await listen();
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[]> = {};
    if (secret) headers["x-admin-secret"] = secret;
    if (xff !== undefined) headers["x-forwarded-for"] = xff;
    const req = http.request({ host: "127.0.0.1", port: p, path: "/api/admin/diagnostics/ip", headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let body: any = {};
        try {
          body = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode ?? 0, body, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Run `fn` under a given ADMIN_SECRET and TRUSTED_EDGE_IPS, fresh brakes. */
async function withEnv<T>(env: { secret?: string | null; edges?: string | null }, fn: () => Promise<T>): Promise<T> {
  const prev = { secret: process.env.ADMIN_SECRET, edges: process.env.TRUSTED_EDGE_IPS };
  const set = (k: string, v: string | null | undefined) => (v == null ? delete process.env[k] : (process.env[k] = v));
  set("ADMIN_SECRET", env.secret === undefined ? SECRET : env.secret);
  set("TRUSTED_EDGE_IPS", env.edges ?? null);
  resetAdminThrottle();
  resetClientAddressForTests();
  try {
    return await fn();
  } finally {
    set("ADMIN_SECRET", prev.secret);
    set("TRUSTED_EDGE_IPS", prev.edges);
    resetClientAddressForTests();
  }
}

const NO_ADDRESS = /\d+\.\d+\.\d+\.\d+|::/;

test("ip diagnostic: absent without ADMIN_SECRET, refused without the right one", async () => {
  await withEnv({ secret: null }, async () => assert.equal((await get(SECRET)).status, 404));
  await withEnv({}, async () => {
    assert.equal((await get("wrong")).status, 401);
    assert.equal((await get(null)).status, 401);
  });
});

test("ip diagnostic: anchored through each hostname, the key's HMAC and no raw client or socket address", async () => {
  await withEnv({ edges: EDGES }, async () => {
    for (const [chain, edge] of [
      [CHAIN, "34.111.179.208"],
      ["34.70.186.43, 34.117.33.233, 35.191.161.107,136.115.121.130", "34.117.33.233"],
      ["203.0.113.9, 34.70.186.43, 34.111.179.208, 35.191.18.188,34.123.18.144", "34.111.179.208"],
    ]) {
      const r = await get(SECRET, chain);
      assert.equal(r.status, 200);
      assert.equal(r.body.anchored, true);
      assert.equal(r.body.reason, "anchored");
      assert.equal(r.body.matchedEdge, edge);
      assert.equal(r.body.listedEdges, 2);
      assert.equal(r.body.settingRefused, false);
      assert.equal(r.body.clientKeyHash, keyDigest("34.70.186.43", SECRET));
      assert.match(r.body.temporary, /Delete/);
      // The matched edge is the operator's own setting; nothing else in the
      // answer may look like an address.
      assert.ok(!NO_ADDRESS.test(r.text.replace(edge, "EDGE")), r.text);
    }
  });
});

test("ip diagnostic: separate X-Forwarded-For header lines are one chain", async () => {
  await withEnv({ edges: EDGES }, async () => {
    const r = await get(SECRET, ["203.0.113.9", "34.70.186.43, 34.111.179.208", "35.191.18.188,34.123.18.144"]);
    assert.equal(r.body.anchored, true);
    assert.equal(r.body.clientKeyHash, keyDigest("34.70.186.43", SECRET));
  });
});

test("ip diagnostic: unset, refused and unrecognised settings all report the shared bucket, still with no address", async () => {
  const shared = keyDigest("127.0.0.1", SECRET);
  const cases: Array<[string | null, string | undefined, string, boolean]> = [
    [null, CHAIN, "unset", false],
    ["true", CHAIN, "unset", true],
    ["34.0.0.0/8", CHAIN, "unset", true],
    [EDGES, undefined, "no_header", false],
    ["9.9.9.9", CHAIN, "no_listed_edge", false],
    [EDGES, "unknown, 34.111.179.208, 35.191.1.1", "bad_client_entry", false],
  ];
  for (const [edges, xff, reason, refused] of cases) {
    await withEnv({ edges }, async () => {
      const r = await get(SECRET, xff);
      assert.equal(r.status, 200);
      assert.equal(r.body.anchored, false, String(edges));
      assert.equal(r.body.reason, reason, String(edges));
      assert.equal(r.body.settingRefused, refused, String(edges));
      assert.equal(r.body.matchedEdge, null);
      assert.equal(r.body.clientKeyHash, shared);
      assert.ok(!NO_ADDRESS.test(r.text), r.text);
    });
  }
});

test("admin throttle: ten wrong secrets lock out that client only — and everyone, as before, when the setting is unset", async () => {
  const other = "198.51.100.4, 34.111.179.208, 35.191.1.1,10.0.0.9";
  await withEnv({ edges: EDGES }, async () => {
    for (let i = 0; i < 10; i++) assert.equal((await get("wrong", CHAIN)).status, 401);
    assert.equal((await get(SECRET, CHAIN)).status, 429);
    // A forged prefix does not buy a fresh bucket.
    assert.equal((await get(SECRET, `1.2.3.4, ${CHAIN}`)).status, 429);
    assert.equal((await get(SECRET, other)).status, 200);
  });
  await withEnv({ edges: null }, async () => {
    for (let i = 0; i < 10; i++) await get("wrong", CHAIN);
    assert.equal((await get(SECRET, other)).status, 429);
  });
});

test("extraction limit: twenty an hour per key, and one key's use leaves another's alone", () => {
  resetRateLimitForTests();
  for (let i = 0; i < 20; i++) assert.equal(overLimit("34.70.186.43"), false);
  assert.equal(overLimit("34.70.186.43"), true);
  assert.equal(overLimit("198.51.100.4"), false);
  resetRateLimitForTests();
});

test("no route keys a brake or an audit on req.ip any more", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const offenders: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.includes(".test.")) continue;
    fs.readFileSync(path.join(dir, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/^\s*\*/.test(code)) return;
        if (/\breq\.ips?\b/.test(code)) offenders.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(offenders, []);
});
