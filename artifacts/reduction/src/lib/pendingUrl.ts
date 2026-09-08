/**
 * client/src/lib/pendingUrl.ts — the one piece of landing-page state that
 * outlives the page.
 *
 * A visitor who finishes the demo types a recipe URL into the inline CTA and
 * is sent to sign-up. That URL has to still be there on the other side, so
 * extraction can run the moment the account exists — otherwise they arrive at
 * an empty library and have to remember what they were about to diagram.
 *
 * Everything else about the demo lives in component state and dies with the
 * component, deliberately. This can't: any real sign-up is a navigation, and
 * React state does not survive one.
 *
 * sessionStorage, not localStorage, and not the library:
 *   - not the library, because a pending URL is an intent, not a recipe —
 *     nothing here creates a row (see storage.ts for what does)
 *   - session-scoped, because an abandoned sign-up should die with the tab
 *     rather than resurface a stale link weeks later
 *
 * Every access is guarded: Safari private mode throws on sessionStorage
 * access rather than returning null, and a lost URL should degrade to an
 * empty sign-up page, never a crash.
 */

const PENDING_URL_KEY = "logic-cooking:pending-url";

export function readPendingUrl(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_URL_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function writePendingUrl(url: string): void {
  try {
    sessionStorage.setItem(PENDING_URL_KEY, url);
  } catch {
    // The in-memory copy App holds still carries this visitor through
    // sign-up; only surviving a reload is lost.
  }
}

export function clearPendingUrl(): void {
  try {
    sessionStorage.removeItem(PENDING_URL_KEY);
  } catch {
    // Nothing to do — a stale key expires with the session regardless.
  }
}
