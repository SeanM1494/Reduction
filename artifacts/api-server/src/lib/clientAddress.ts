/**
 * lib/clientAddress.ts — which CLIENT a request came from, for the per-client
 * brakes: the extraction and search limit, the admin failure throttle, and the
 * address an admin audit row records. PURE apart from reading one env var.
 *
 * WHY NOT `req.ip`. Behind Replit's deployment the socket's peer is a proxy on
 * loopback, so `req.ip` was `::ffff:127.0.0.1` for EVERY request (measured on
 * the deployment, Sep 30): every user on an instance shared one bucket of 20
 * extractions an hour. Express's `trust proxy` count would fix it by
 * trusting the last N hops, but a count is only right while the chain keeps
 * its length — one hop fewer and it lands on an entry the CLIENT wrote, and
 * every limit becomes a formality nobody notices. It would also change
 * `req.ip` for the whole app. So `req.ip` is left alone and this decides.
 *
 * THE ANCHOR. Google's load balancer appends `<client>,<its own address>` to
 * X-Forwarded-For, after whatever the client sent; Replit's hops then append
 * their own. Six samples through both hostnames showed a different last hop
 * each time and the load balancer's address, per hostname, every time. So the
 * client is the entry immediately LEFT of the RIGHTMOST address listed in
 * TRUSTED_EDGE_IPS. Anything a client forges sits further left, including a
 * forged copy of a listed address, because the real one was appended after it.
 *
 * FAILS SHARED, NEVER SPOOFABLE. No listed address in the chain, nothing valid
 * left of it, no header, or no (valid) setting: the key is the socket's peer —
 * the shared bucket this replaced, which is merely today's behaviour. When the
 * setting is present but no listed address appears, the log names the entry
 * where one should have been (see `edgeCandidate`) so the fix is a secret
 * edit. A client address is never logged; where a key must be shown, it
 * is an HMAC of it (`keyDigest`).
 */

import crypto from "node:crypto";
import { isIP } from "node:net";

/** Entries read from the right of X-Forwarded-For; the rest is never parsed. */
export const MAX_FORWARDED_ENTRIES = 16;
/** Listed addresses TRUSTED_EDGE_IPS may carry. */
export const MAX_EDGE_IPS = 10;

// ------------------------------------------------------------------ addresses

function v4ToInt(a: string): number {
  return a.split(".").reduce((n, p) => n * 256 + Number(p), 0);
}

/** 8 lower-case groups, no compression, or null. Accepts an embedded IPv4 tail. */
function expandV6(a: string): string[] | null {
  let s = a.toLowerCase();
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (isIP(tail[1]) !== 4) return null;
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array(fill).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * One address in a canonical spelling, or null for anything that is not one:
 * trimmed; `[v6]`, `[v6]:port` and `v4:port` unwrapped; a v6 zone dropped;
 * v6 as 8 lower-case unpadded groups; an IPv4-mapped v6 (`::ffff:1.2.3.4`,
 * `::ffff:102:304`) as the IPv4 it maps.
 */
export function normalizeAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length > 64) return null;
  const bracket = s.match(/^\[([^\]]+)\](?::\d{1,5})?$/);
  if (bracket) s = bracket[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  s = s.replace(/%[0-9a-z._-]+$/i, "");
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return null;
  const g = expandV6(s);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === "0") && g[5] === "ffff") {
    const n = parseInt(g[6], 16) * 65536 + parseInt(g[7], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return g.join(":");
}

/** The bucket an address counts in: an IPv4 address alone, an IPv6 address
 *  by its /64 — one phone holds a whole /64 and could otherwise rotate
 *  through it to dodge every limit. Takes a NORMALISED address. */
export function keyForAddress(addr: string): string {
  if (!addr.includes(":")) return addr;
  return `${addr.split(":").slice(0, 4).join(":")}::/64`;
}

// ------------------------------------------------------------------ the setting

export interface EdgeConfig {
  ips: ReadonlySet<string>;
  /** Why the value was refused; null when valid or unset. */
  problem: string | null;
}

/** TRUSTED_EDGE_IPS: comma-separated IPv4/IPv6 addresses, at most ten. Any
 *  fault refuses the WHOLE value — a half-applied list is a list nobody
 *  wrote — which leaves today's shared bucket, never something looser. */
export function parseEdgeIps(raw: string | undefined): EdgeConfig {
  if (raw === undefined || raw.trim() === "") return { ips: new Set(), problem: null };
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length > MAX_EDGE_IPS)
    return { ips: new Set(), problem: `lists ${parts.length} entries; at most ${MAX_EDGE_IPS} are allowed` };
  const ips = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    // A bare address only: normalizeAddress would also unwrap a port or
    // brackets, which is leniency for a HEADER, not for a setting.
    const a = isIP(parts[i]) ? normalizeAddress(parts[i]) : null;
    if (!a) return { ips: new Set(), problem: `entry ${i + 1} of ${parts.length} is not an IPv4 or IPv6 address` };
    ips.add(a);
  }
  return { ips, problem: null };
}

let memo: { raw: string | undefined; config: EdgeConfig } | null = null;

/** The setting as this process reads it, parsed once per distinct value; a
 *  refused value is warned about once, at boot (index.ts) or first use. */
export function edgeConfig(): EdgeConfig {
  const raw = process.env.TRUSTED_EDGE_IPS;
  if (memo && memo.raw === raw) return memo.config;
  const config = parseEdgeIps(raw);
  memo = { raw, config };
  if (config.problem)
    console.warn(`[client-key] TRUSTED_EDGE_IPS refused (${config.problem}); every client shares one limit bucket until it is fixed.`);
  return config;
}

// ------------------------------------------------------------------ resolution

export type ClientReason =
  | "anchored"
  | "unset" // no TRUSTED_EDGE_IPS (or a refused one)
  | "no_header" // no X-Forwarded-For at all
  | "no_listed_edge" // a header, but no listed address in what was read
  | "bad_client_entry"; // a listed address, and nothing valid left of it

export interface ClientResolution {
  key: string;
  reason: ClientReason;
  /** The listed address that anchored, when one did. */
  edge: string | null;
  /** Only for "no_listed_edge": where a load balancer's address appears to
   *  sit, for the operator to add — see `edgeCandidate`. Never a client. */
  candidate: string | null;
}

/** The rightmost `max` entries of the header(s), in order, without splitting
 *  anything further left: a header can be as long as the client likes. */
export function rightmostEntries(header: string | readonly string[] | undefined, max = MAX_FORWARDED_ENTRIES): string[] {
  if (header === undefined) return [];
  // Separate header lines arrive in order and a proxy appends to the chain
  // as a whole, so the lines are one list read left to right.
  const s = typeof header === "string" ? header : header.join(",");
  const out: string[] = [];
  let end = s.length;
  while (out.length < max) {
    const i = s.lastIndexOf(",", end - 1);
    out.unshift(s.slice(i + 1, end));
    if (i < 0) break;
    end = i;
  }
  return out;
}

const inV4Cidr = (a: string, base: string, bits: number) =>
  !a.includes(":") && (v4ToInt(a) >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits));
/** Google's documented source ranges for load-balancer proxies (GFE). */
const isGoogleProxy = (a: string) => inV4Cidr(a, "35.191.0.0", 16) || inV4Cidr(a, "130.211.0.0", 22);

/**
 * With no listed address in the chain, the address to name in the log: the
 * entry left of the RIGHTMOST Google load-balancer proxy (35.191.0.0/16,
 * 130.211.0.0/22). Such a proxy is where the load balancer hands on, and the
 * load balancer writes its own address LAST, so the entry left of that hop
 * is the load balancer — never the client, which the load balancer writes
 * before its own. No such hop in the chain, and nothing is named: a chain
 * whose shape is not understood is a chain in which the "third from the
 * right" could be a person.
 */
export function edgeCandidate(entries: readonly (string | null)[]): string | null {
  for (let i = entries.length - 1; i > 0; i--) {
    const a = entries[i];
    if (a && isGoogleProxy(a)) return entries[i - 1] && !isGoogleProxy(entries[i - 1]!) ? entries[i - 1] : null;
  }
  return null;
}

export function resolveClient(
  forwardedFor: string | readonly string[] | undefined,
  socketAddress: string | undefined,
  edges: ReadonlySet<string>
): ClientResolution {
  const socket = normalizeAddress(socketAddress ?? "");
  const fallback = (reason: ClientReason, candidate: string | null = null): ClientResolution => ({
    key: socket ? keyForAddress(socket) : "unknown",
    reason,
    edge: null,
    candidate,
  });
  if (edges.size === 0) return fallback("unset");
  const raw = rightmostEntries(forwardedFor);
  if (!raw.length || (raw.length === 1 && !raw[0].trim())) return fallback("no_header");
  const entries = raw.map(normalizeAddress);
  for (let i = entries.length - 1; i >= 0; i--) {
    const a = entries[i];
    if (!a || !edges.has(a)) continue;
    const client = i > 0 ? entries[i - 1] : null;
    // A listed address is infrastructure, not a person, and cannot be one.
    if (!client || edges.has(client)) return fallback("bad_client_entry");
    return { key: keyForAddress(client), reason: "anchored", edge: a, candidate: null };
  }
  return fallback("no_listed_edge", edgeCandidate(entries));
}

const namedCandidates = new Set<string>();
let unnamedWarned = false;

/** Log a chain with no listed address, once per candidate per process (and
 *  once for "could not name one"). Only ever the candidate, never a client. */
function noteUnlisted(r: ClientResolution): void {
  if (r.reason !== "no_listed_edge") return;
  if (r.candidate) {
    if (namedCandidates.has(r.candidate) || namedCandidates.size >= 20) return;
    namedCandidates.add(r.candidate);
    console.warn(
      `[client-key] a request arrived through ${r.candidate}, which TRUSTED_EDGE_IPS does not list; it counted in the shared bucket. If that is Replit's load balancer, add it to the secret.`
    );
  } else if (!unnamedWarned) {
    unnamedWarned = true;
    console.warn("[client-key] a request's forwarding chain named no listed address and no Google proxy hop; it counted in the shared bucket.");
  }
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  headersDistinct?: Record<string, string[] | undefined>;
  socket: { remoteAddress?: string };
}

/** The resolution for a live request, under the current setting. */
export function requestClient(req: RequestLike): ClientResolution {
  const header = req.headersDistinct?.["x-forwarded-for"] ?? req.headers["x-forwarded-for"];
  const r = resolveClient(header, req.socket.remoteAddress, edgeConfig().ips);
  noteUnlisted(r);
  return r;
}

/** What every per-client brake keys on. */
export const clientKey = (req: RequestLike): string => requestClient(req).key;

/** A key as it may be shown or logged: an HMAC under the admin secret, so it
 *  is stable across instances and cannot be reversed by trying all 2^32
 *  IPv4 addresses without the secret. */
export function keyDigest(key: string, secret = process.env.ADMIN_SECRET ?? ""): string {
  return crypto.createHmac("sha256", secret).update(key).digest("hex").slice(0, 12);
}

/** Test seam: the once-only logs and the memo are process-global. */
export function resetClientAddressForTests(): void {
  memo = null;
  namedCandidates.clear();
  unnamedWarned = false;
}
