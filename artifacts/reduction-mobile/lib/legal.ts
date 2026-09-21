/**
 * lib/legal.ts — where the Terms of Use and Privacy Policy live, as the app
 * links them. They are pages on the website (static HTML at /terms and
 * /privacy), reached through the same host the app already links for
 * managing a web plan: `webUrl` from /api/billing/config, which is the
 * server's PUBLIC_BASE_URL, with the public domain as the fallback when
 * the server has not said. Pure, so the runner can test it.
 */

export type LegalPage = 'terms' | 'privacy';

export const LEGAL_FALLBACK_HOST = 'https://recipereduction.com';

export function legalUrl(webUrl: string | null | undefined, page: LegalPage): string {
  const host = (webUrl && webUrl.trim()) || LEGAL_FALLBACK_HOST;
  return `${host.replace(/\/+$/, '')}/${page}`;
}

/** The sentence Apple wants beside a subscription price (guideline 3.1.2):
 *  that it renews, and where it is cancelled. */
export const RENEWAL_TERMS =
  'Renews automatically until cancelled. Manage or cancel in your App Store account settings.';
