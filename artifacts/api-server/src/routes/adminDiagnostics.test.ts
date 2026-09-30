/**
 * routes/adminDiagnostics.test.ts — the TEMPORARY IP diagnostic (Sep 30).
 * No database: the admin guard reads only the secret and its throttle.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { adminRouter, resetAdminThrottle } from "./admin";

const SECRET = "test-admin-secret-ip-0123456789";
let server: Server | null = null;
let base = "";

async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

after(() => server?.close());

async function probe(secret: string | null, headers: Record<string, string> = {}, env: string | null = SECRET) {
  const prev = process.env.ADMIN_SECRET;
  if (env === null) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = env;
  resetAdminThrottle();
  try {
    const res = await fetch(`${await listen()}/api/admin/diagnostics/ip`, {
      headers: { ...(secret ? { "x-admin-secret": secret } : {}), ...headers },
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
}

test("ip diagnostic: absent without ADMIN_SECRET, refused without the right one", async () => {
  assert.equal((await probe(SECRET, {}, null)).status, 404);
  assert.equal((await probe("wrong")).status, 401);
  assert.equal((await probe(null)).status, 401);
});

test("ip diagnostic: reports the socket's peer as req.ip while trust proxy is off, and echoes the forwarding headers", async () => {
  const r = await probe(SECRET, { "x-forwarded-for": "203.0.113.7, 10.0.0.2", "x-real-ip": "203.0.113.7" });
  assert.equal(r.status, 200);
  assert.equal(r.body.trustProxy, false);
  // The limiter keys on the connection, not on what the client says: this
  // is the behaviour the diagnostic exists to observe on the deployment.
  assert.match(r.body.reqIp, /127\.0\.0\.1/);
  assert.equal(r.body.extractionLimitKey, r.body.reqIp);
  assert.equal(r.body.headers["x-forwarded-for"], "203.0.113.7, 10.0.0.2");
  assert.equal(r.body.headers["x-real-ip"], "203.0.113.7");
  assert.match(r.body.temporary, /Remove/);
});
