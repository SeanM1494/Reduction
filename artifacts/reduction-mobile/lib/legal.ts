/**
 * lib/legal.ts — where the Terms of Use and Privacy Policy live, as the app
 * links them. They are static HTML files on the website, linked by their
 * FILE name (/terms.html, /privacy.html): the published site is Replit's
 * static hosting, which answers any path it has no file for with the web
 * app, so /terms opened the recipe library (Sep 24, TestFlight). A file
 * that exists is served by any host. The host is the one the app already
 * links for managing a web plan: `webUrl` from /api/billing/config, which
 * is the server's PUBLIC_BASE_URL, with the public domain as the fallback
 * when the server has not said. Pure, so the runner can test it.
 */

export type LegalPage = 'terms' | 'privacy';

export const LEGAL_FALLBACK_HOST = 'https://recipereduction.com';

export function legalUrl(webUrl: string | null | undefined, page: LegalPage): string {
  const host = (webUrl && webUrl.trim()) || LEGAL_FALLBACK_HOST;
  return `${host.replace(/\/+$/, '')}/${page}.html`;
}

/** The sentence Apple wants beside a subscription price (guideline 3.1.2):
 *  that it renews, and where it is cancelled. */
export const RENEWAL_TERMS =
  'Renews automatically until cancelled. Manage or cancel in your App Store account settings.';
