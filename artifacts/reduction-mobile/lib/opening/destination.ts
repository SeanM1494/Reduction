/**
 * lib/opening/destination.ts — where a cold start lands. PURE.
 *
 *   - Signed out: the demo (the Gate already shows it; nothing to do).
 *   - Signed in: the Recipe Box (the Library tab) — on the last-open book
 *     when there are recipes, the "Nothing saved yet" invitation when there
 *     are none. Never the paywall: that tab has none.
 *
 * Applied on EVERY cold start when LAND_ON_RECIPE_BOX is on, not only when
 * the sequence plays (decided Sep 29); never over a notification tap or a
 * link, which go where they point, and never on a return from the
 * background, which keeps the screen that was open.
 */

import type { LaunchSource } from './cadence';

export type Landing = 'recipe-box' | 'stay';

export function launchLanding(o: { enabled: boolean; signedIn: boolean; coldStart: boolean; source: LaunchSource }): Landing {
  if (!o.enabled || !o.signedIn || !o.coldStart || o.source !== 'normal') return 'stay';
  return 'recipe-box';
}

/** The shelf position of the book last open, by its ID — so it survives
 *  custom books, renames and reordering — or the first book when that one
 *  is gone. */
export function restoreBookIndex(shelfIds: string[], storedId: string | null): number {
  if (!storedId) return 0;
  const i = shelfIds.indexOf(storedId);
  return i >= 0 ? i : 0;
}

/**
 * Whether the URL the app was opened with is a link INTO the app — so the
 * launch goes where it points rather than playing the intro or landing on
 * the Recipe Box. The app's own scheme with a path is one; a bare scheme,
 * the sign-in return (handled inside a session, never a launch) and the
 * development client's own launch URL are not. There are no universal
 * links configured today (no associatedDomains); an https link would be
 * one if there were.
 */
export function isAppLink(url: string | null | undefined, scheme: string): boolean {
  if (!url) return false;
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)/i);
  if (!m) return false;
  const [, s, rest] = m;
  if (s.toLowerCase() === 'https') return true;
  if (s.toLowerCase() !== scheme.toLowerCase()) return false;
  const path = rest.replace(/^\/+|\/+$/g, '');
  return path !== '' && path !== 'auth' && !path.startsWith('expo-development-client');
}
