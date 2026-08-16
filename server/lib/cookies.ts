/**
 * server/lib/cookies.ts — the ~40 lines of cookie handling this app needs.
 *
 * Express 4 has no cookie parsing built in. Rather than take a dependency for
 * one cookie, this reads the header and builds the Set-Cookie value directly.
 * If a second cookie ever appears with real option requirements, replace this
 * with cookie-parser rather than growing it.
 */

import type { Request } from "express";

/** Reads one cookie by name. Returns null when absent or malformed. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A cookie we cannot decode is a cookie we cannot trust.
      return null;
    }
  }
  return null;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  /** Omit Secure in development, where there is no https to be secure over. */
  secure?: boolean;
}

/**
 * SameSite=Lax rather than Strict: an OAuth callback is a cross-site
 * navigation back to us, and Strict would withhold the cookie on exactly that
 * request. Lax still blocks it on cross-site POSTs, which is the CSRF case
 * that matters — and the `state` parameter covers the handshake itself.
 */
export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {}
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.maxAgeSeconds != null) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Max-Age=0 with an empty value — the standard way to ask for a delete. */
export function clearCookie(name: string, opts: CookieOptions = {}): string {
  return serializeCookie(name, "", { ...opts, maxAgeSeconds: 0 });
}
