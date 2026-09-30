/**
 * routes/clientKey.test.ts — the per-client key where the routes use it
 * (Sep 30): the admin throttle, through real requests, locks out one
 * client rather than everybody; the extraction limit counts per key; and
 * no route keys a brake on `req.ip` again. The key itself is
 * lib/clientAddress.test.ts. No database: the admin guard reads only the
 * secret.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http, { createServer, type Server } from "node:http";
import { requireAdmin, resetAdminThrottle } from "./admin";
import { overLimit, resetRateLimitForTests } from "./recipes";
import { resetClientAddressForTests } from "../lib/clientAddress";

const SECRET = "test-admin-secret-ip-0123456789";
const EDGES = "34.111.179.208,34.117.33.233";
const CHAIN = "34.70.186.43, 34.111.179.208, 35.191.161.29,136.115.121.130";
let server: Server | null = null;
let port = 0;

async function listen(): Promise<number> {
  if (port) return port;
  const app = express();
  // The admin guard alone, in front of nothing: what every admin route
  // runs first, and the throttle under test.
  app.get("/guarded", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.status(204).end();
  });
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  return port;
}

after(() => server?.close());

/** http.request rather than fetch: an ARRAY value goes out as separate
 *  header lines, which fetch would merge before sending. */
async function get(secret: string | null, xff?: string | string[], path = "/guarded"): Promise<{ status: number; body: any; text: string }> {
  const p = await listen();
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[]> = {};
    if (secret) headers["x-admin-secret"] = secret;
    if (xff !== undefined) headers["x-forwarded-for"] = xff;
    const req = http.request({ host: "127.0.0.1", port: p, path, headers }, (res) => {
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

test("admin throttle: ten wrong secrets lock out that client only — and everyone, as before, when the setting is unset", async () => {
  const other = "198.51.100.4, 34.111.179.208, 35.191.1.1,10.0.0.9";
  await withEnv({ edges: EDGES }, async () => {
    for (let i = 0; i < 10; i++) assert.equal((await get("wrong", CHAIN)).status, 401);
    assert.equal((await get(SECRET, CHAIN)).status, 429);
    // A forged prefix does not buy a fresh bucket.
    assert.equal((await get(SECRET, `1.2.3.4, ${CHAIN}`)).status, 429);
    // Nor does the same chain sent as separate header lines.
    assert.equal((await get(SECRET, ["1.2.3.4", "34.70.186.43, 34.111.179.208", "35.191.161.29,136.115.121.130"])).status, 429);
    // The same client through the phone's hostname is still that client.
    assert.equal((await get(SECRET, "34.70.186.43, 34.117.33.233, 35.191.161.107,136.115.121.130")).status, 429);
    assert.equal((await get(SECRET, other)).status, 204);
  });
  await withEnv({ edges: null }, async () => {
    for (let i = 0; i < 10; i++) await get("wrong", CHAIN);
    assert.equal((await get(SECRET, other)).status, 429);
  });
});

test("admin guard: absent without ADMIN_SECRET, refused without the right one", async () => {
  await withEnv({ secret: null }, async () => assert.equal((await get(SECRET)).status, 404));
  await withEnv({}, async () => {
    assert.equal((await get("wrong")).status, 401);
    assert.equal((await get(null)).status, 401);
    assert.equal((await get(SECRET)).status, 204);
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
