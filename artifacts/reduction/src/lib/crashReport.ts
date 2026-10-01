/**
 * lib/crashReport.ts — what the website tells the server when it breaks
 * (Oct 1; the phone's half is reduction-mobile/lib/crashReporter.ts, and the
 * report's shape and scrubbing are recipe-model `crashReport.ts`, shared so
 * the two cannot drift).
 *
 * Two ways in: the root ErrorBoundary (`render`, the "Something went wrong"
 * screen) and the window's uncaught `error` event (`error`). A page sends
 * each distinct crash once and at most PER_PAGE in all, so a render loop is
 * one report, not a flood. No cookie goes with it (`credentials: "omit"`),
 * so a report cannot carry the session even in a header.
 *
 * Off in development, judged by the HOST, not `import.meta.env.DEV`: a
 * shell with NODE_ENV=development builds a "production" bundle with DEV
 * true (this container does), and a reporter silenced that way would look
 * exactly like a site with no crashes. The workspace preview is
 * `*.replit.dev`, and its dev server writes to production.
 */

import { crashFingerprintSource, crashReportFrom, type CrashKind } from "@workspace/recipe-model/crashReport";

const PER_PAGE = 10;
const sent = new Set<string>();

function isDevHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".replit.dev");
}

export function reportCrash(kind: CrashKind, error: unknown, componentStack?: string): void {
  if (isDevHost()) return;
  try {
    const report = crashReportFrom(kind, error, { platform: "web", route: window.location.pathname }, componentStack);
    const key = crashFingerprintSource(report);
    if (sent.size >= PER_PAGE || sent.has(key)) return;
    sent.add(key);
    void fetch("/api/crash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A reporter never becomes a second error.
  }
}

/** Once, at boot. */
export function installCrashReporter(): void {
  window.addEventListener("error", (e) => reportCrash("error", e.error ?? e.message));
}
