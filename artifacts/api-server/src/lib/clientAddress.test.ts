/**
 * lib/clientAddress.test.ts — the per-client key (Sep 30). The chains below
 * are the SIX real X-Forwarded-For values the deployment reported, through
 * both hostnames, so a change that stops recognising what Replit actually
 * sends fails here first.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EDGE_IPS,
  MAX_FORWARDED_ENTRIES,
  edgeCandidate,
  keyDigest,
  keyForAddress,
  normalizeAddress,
  parseEdgeIps,
  resolveClient,
  rightmostEntries,
} from "./clientAddress";

const SITE_EDGE = "34.111.179.208"; // recipereduction.com
const APP_EDGE = "34.117.33.233"; // recipe-reduction.replit.app
const EDGES = new Set([SITE_EDGE, APP_EDGE]);
const SOCKET = "::ffff:127.0.0.1";

const REAL: Array<[string, string, string]> = [
  ["136.114.237.211, 34.111.179.208, 35.191.82.104,35.254.199.172", "136.114.237.211", SITE_EDGE],
  ["34.70.186.43, 34.111.179.208, 35.191.161.29,136.115.121.130", "34.70.186.43", SITE_EDGE],
  ["203.0.113.9, 34.70.186.43, 34.111.179.208, 35.191.18.188,34.123.18.144", "34.70.186.43", SITE_EDGE],
  ["34.70.186.43, 34.117.33.233, 35.191.161.107,136.115.121.130", "34.70.186.43", APP_EDGE],
  ["34.70.186.43, 34.111.179.208, 35.191.16.19,34.68.165.33", "34.70.186.43", SITE_EDGE],
];

test("client key: every chain the deployment reported resolves to the client, anchored on its hostname's load balancer", () => {
  for (const [header, client, edge] of REAL) {
    const r = resolveClient(header, SOCKET, EDGES);
    assert.deepEqual(r, { key: client, reason: "anchored", edge, candidate: null }, header);
  }
});

test("client key: a forged prefix changes nothing, including a forged copy of a listed address", () => {
  const tail = "34.70.186.43, 34.111.179.208, 35.191.18.188,34.123.18.144";
  for (const forged of ["6.6.6.6", "6.6.6.6, 7.7.7.7", "6.6.6.6, 34.111.179.208", "34.111.179.208", "unknown, , 1.1.1.1"])
    assert.equal(resolveClient(`${forged}, ${tail}`, SOCKET, EDGES).key, "34.70.186.43", forged);
});

test("client key: two anchors — a forged SITE edge sent through the APP hostname is ignored for the real APP edge on its right", () => {
  const r = resolveClient("6.6.6.6, 34.111.179.208, 34.70.186.43, 34.117.33.233, 35.191.161.107,136.115.121.130", SOCKET, EDGES);
  assert.equal(r.key, "34.70.186.43");
  assert.equal(r.edge, APP_EDGE);
  // ...and the mirror image.
  const m = resolveClient("6.6.6.6, 34.117.33.233, 34.70.186.43, 34.111.179.208, 35.191.16.19,34.68.165.33", SOCKET, EDGES);
  assert.equal(m.key, "34.70.186.43");
  assert.equal(m.edge, SITE_EDGE);
});

test("client key: the anchor holds however many hops follow the load balancer", () => {
  for (const tail of ["", ", 35.191.1.1", ", 35.191.1.1,10.0.0.1", ", 35.191.1.1,10.0.0.1, 10.0.0.2, 10.0.0.3"])
    assert.equal(resolveClient(`34.70.186.43, ${SITE_EDGE}${tail}`, SOCKET, EDGES).key, "34.70.186.43", tail);
});

test("client key: falls back to the socket — the shared bucket, never an entry the client wrote", () => {
  const shared = keyForAddress(normalizeAddress(SOCKET)!);
  assert.equal(shared, "127.0.0.1");
  const cases: Array<[string | string[] | undefined, Set<string>, string]> = [
    [REAL[0][0], new Set(), "unset"],
    [undefined, EDGES, "no_header"],
    ["", EDGES, "no_header"],
    ["   ", EDGES, "no_header"],
    [[], EDGES, "no_header"],
    ["34.70.186.43, 34.99.99.99, 35.191.1.1,10.1.1.1", EDGES, "no_listed_edge"],
    [`${SITE_EDGE}, 35.191.1.1,10.1.1.1`, EDGES, "bad_client_entry"],
    [`, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    [`unknown, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    [`999.1.1.1, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    [`1.2.3, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    [`01.2.3.4, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    [`${APP_EDGE}, ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
    // The client entry itself is never skipped over to reach a valid one.
    [`34.70.186.43, , ${SITE_EDGE}, 35.191.1.1`, EDGES, "bad_client_entry"],
  ];
  for (const [header, edges, reason] of cases) {
    const r = resolveClient(header, SOCKET, edges);
    assert.equal(r.key, shared, JSON.stringify(header));
    assert.equal(r.reason, reason, JSON.stringify(header));
    assert.equal(r.edge, null);
  }
  assert.equal(resolveClient(undefined, undefined, EDGES).key, "unknown");
});

test("client key: stray whitespace and empty entries elsewhere in the chain are tolerated", () => {
  assert.equal(resolveClient("  34.70.186.43 ,\t34.111.179.208 ,35.191.1.1,  ", SOCKET, EDGES).key, "34.70.186.43");
  assert.equal(resolveClient(",,, 34.70.186.43,34.111.179.208,,35.191.1.1", SOCKET, EDGES).key, "34.70.186.43");
});

test("client key: several header lines read as one chain, in order", () => {
  const r = resolveClient(["203.0.113.9", "34.70.186.43, 34.111.179.208", "35.191.18.188,34.123.18.144"], SOCKET, EDGES);
  assert.equal(r.key, "34.70.186.43");
  // A client-supplied first line cannot outrank the real anchor after it.
  assert.equal(resolveClient(["6.6.6.6, 34.111.179.208", REAL[1][0]], SOCKET, EDGES).key, "34.70.186.43");
});

test("client key: a very long header is read only from the right, up to the cap", () => {
  const junk = Array.from({ length: 50_000 }, (_, i) => `10.${(i >> 8) & 255}.${i & 255}.1`).join(", ");
  const t0 = Date.now();
  assert.equal(resolveClient(`${junk}, ${REAL[1][0]}`, SOCKET, EDGES).key, "34.70.186.43");
  assert.ok(Date.now() - t0 < 200, "reads only the tail");
  assert.equal(rightmostEntries(`${junk}, a, b`).length, MAX_FORWARDED_ENTRIES);
  assert.deepEqual(rightmostEntries("a,b,c", 2), ["b", "c"]);
  // An anchor further left than the cap is not searched for.
  const far = `34.70.186.43, ${SITE_EDGE}, ${Array(MAX_FORWARDED_ENTRIES).fill("10.0.0.1").join(", ")}`;
  assert.equal(resolveClient(far, SOCKET, EDGES).reason, "no_listed_edge");
});

test("addresses: IPv6 spellings canonicalise, IPv4-mapped IPv6 is the IPv4, junk is null", () => {
  const same = ["2001:db8:0:0:1:0:0:1", "2001:DB8::1:0:0:1", "2001:0db8:0000:0000:0001:0000:0000:0001", "[2001:db8::1:0:0:1]", "[2001:db8::1:0:0:1]:443", " 2001:db8::1:0:0:1 ", "2001:db8::1:0:0:1%en0"];
  for (const s of same) assert.equal(normalizeAddress(s), "2001:db8:0:0:1:0:0:1", s);
  for (const s of ["::ffff:34.70.186.43", "::FFFF:34.70.186.43", "::ffff:2246:ba2b", "0:0:0:0:0:ffff:2246:ba2b", "[::ffff:34.70.186.43]:80", "34.70.186.43:8080"])
    assert.equal(normalizeAddress(s), "34.70.186.43", s);
  for (const s of ["", "unknown", "999.1.1.1", "1.2.3", "01.2.3.4", "2001:db8:::1", "2001:db8::1::2", "g::1", "[1.2.3.4", "1.2.3.4/24", "a".repeat(80), "_hidden", "obfuscated"])
    assert.equal(normalizeAddress(s), null, s);
});

test("addresses: IPv4 is its own bucket; IPv6 buckets by /64 however it is spelled", () => {
  assert.equal(keyForAddress("34.70.186.43"), "34.70.186.43");
  const edges = new Set([SITE_EDGE]);
  const key = (client: string) => resolveClient(`${client}, ${SITE_EDGE}, 35.191.1.1`, SOCKET, edges).key;
  assert.equal(key("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(key("2001:DB8:1:2:ffff:ffff:ffff:ffff"), key("2001:db8:0001:0002::7"));
  assert.notEqual(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
  assert.equal(key("::ffff:34.70.186.43"), key("34.70.186.43"));
  // A listed address spelled as IPv4-mapped still anchors.
  assert.equal(resolveClient(`34.70.186.43, ::ffff:${SITE_EDGE}`, SOCKET, edges).key, "34.70.186.43");
});

test("setting: valid lists parse; anything else is refused WHOLE, leaving the shared bucket", () => {
  assert.deepEqual([...parseEdgeIps(`${SITE_EDGE},${APP_EDGE}`).ips], [SITE_EDGE, APP_EDGE]);
  assert.deepEqual([...parseEdgeIps(` ${SITE_EDGE} , ${APP_EDGE} `).ips], [SITE_EDGE, APP_EDGE]);
  assert.deepEqual([...parseEdgeIps("2001:DB8::1").ips], ["2001:db8:0:0:0:0:0:1"]);
  for (const unset of [undefined, "", "   "]) assert.deepEqual(parseEdgeIps(unset), { ips: new Set(), problem: null });
  const ten = Array.from({ length: MAX_EDGE_IPS }, (_, i) => `34.0.0.${i + 1}`);
  assert.equal(parseEdgeIps(ten.join(",")).ips.size, MAX_EDGE_IPS);
  for (const bad of ["true", "1", "*", `${SITE_EDGE},,${APP_EDGE}`, `${SITE_EDGE},`, `${SITE_EDGE};${APP_EDGE}`, `${SITE_EDGE} ${APP_EDGE}`, "34.0.0.0/8", "recipereduction.com", `${SITE_EDGE}:443`, `[${"2001:db8::1"}]`, "999.1.1.1", [...ten, "34.0.0.99"].join(",")]) {
    const c = parseEdgeIps(bad);
    assert.equal(c.ips.size, 0, bad);
    assert.ok(c.problem, bad);
    // The refusal says what is wrong without repeating the value.
    assert.ok(!c.problem!.includes("34.") && !c.problem!.includes("recipereduction"), c.problem!);
    assert.equal(resolveClient(REAL[1][0], SOCKET, c.ips).key, "127.0.0.1");
  }
});

test("the unknown-edge log names only a load balancer, never a client", () => {
  // In every real chain the candidate is the load balancer.
  for (const [header, client, edge] of REAL) {
    const r = resolveClient(header, SOCKET, new Set(["9.9.9.9"]));
    assert.equal(r.reason, "no_listed_edge");
    assert.equal(r.candidate, edge, header);
    assert.notEqual(r.candidate, client);
  }
  // A chain whose shape is not understood names nothing, even when the
  // "third from the right" is there to be named: it could be a person.
  const odd = ["34.70.186.43, 10.0.0.1, 10.0.0.2", "34.70.186.43, 34.111.179.208", "35.191.1.1", "34.70.186.43, 35.191.1.1, 35.191.2.2"];
  for (const h of odd) assert.equal(resolveClient(h, SOCKET, new Set(["9.9.9.9"])).candidate, null, h);
  assert.equal(edgeCandidate([]), null);
  // Unset is silent: a candidate is only named when someone meant to list one.
  assert.equal(resolveClient(REAL[0][0], SOCKET, new Set()).candidate, null);
});

test("digest: stable for a key under one secret, different under another, and not the address", () => {
  assert.equal(keyDigest("34.70.186.43", "s1"), keyDigest("34.70.186.43", "s1"));
  assert.notEqual(keyDigest("34.70.186.43", "s1"), keyDigest("34.70.186.43", "s2"));
  assert.notEqual(keyDigest("34.70.186.43", "s1"), keyDigest("34.70.186.44", "s1"));
  assert.match(keyDigest("34.70.186.43", "s1"), /^[0-9a-f]{12}$/);
});
