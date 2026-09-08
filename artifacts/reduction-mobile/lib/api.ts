/**
 * lib/api.ts — every request the app makes to the shared api-server.
 *
 * Mirrors artifacts/reduction/src/lib/api.ts and lib/storage.ts endpoint for
 * endpoint, but as hand-written fetch wrappers (the web app has no
 * OpenAPI/codegen layer, so mirroring that shape here would just be a second,
 * divergence-prone description of the same routes).
 *
 * Auth is a bearer token (see auth-context.tsx) rather than a cookie — every
 * call attaches `Authorization: Bearer <token>` when one is set. There is no
 * anonymous X-Owner-Key path on mobile: sign-in is required before any
 * extraction or library call, so every request here is already scoped to an
 * account by the server.
 */

import type { Recipe } from '@/shared/layout';
import type { OrderPreference } from '@/shared/sequence';

let authToken: string | null = null;

/** Set by auth-context.tsx whenever the signed-in token changes. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

function baseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('EXPO_PUBLIC_DOMAIN is not set.');
  return `https://${domain}`;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: string[];
  entry?: unknown;
  constructor(message: string, status: number, extra?: { code?: string; details?: string[]; entry?: unknown }) {
    super(message);
    this.status = status;
    this.code = extra?.code;
    this.details = extra?.details;
    this.entry = extra?.entry;
  }
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error || `Request failed (${res.status}).`, res.status, {
      code: typeof body.code === 'string' ? body.code : undefined,
      details: Array.isArray(body.details) ? body.details : undefined,
      entry: body.entry,
    });
  }
  return body;
}

// ---------------------------------------------------------------- auth ----

export interface MeResponse {
  user: { id: string; email: string | null; name: string | null } | null;
}

export const fetchMe = (): Promise<MeResponse> => request('/api/auth/me');

export const signOutServer = (): Promise<void> =>
  request('/api/auth/logout', { method: 'POST' }).catch(() => {});

/** The server always redirects the mobile handshake back to the fixed
 *  `reduction-mobile://auth` deep link (see server/routes/auth.ts —
 *  mobileRedirect()); there is no redirect_uri parameter to pass. */
/**
 * `redirectUri` is `Linking.createURL('auth')` from the caller — a real deep
 * link back into whichever runtime is asking: `reduction-mobile://auth` in a
 * standalone/App Store build, but something host-specific under Expo Go
 * (e.g. `exp://<dev-host>/--/auth`) in development, since Expo Go owns the
 * `exp:` scheme rather than the app's own. The server validates this against
 * an allowlist (see mobileRedirect/isAllowedMobileRedirect in
 * server/routes/auth.ts) before ever redirecting to it, so a caller cannot
 * point the handoff code at an arbitrary URL.
 */
export function mobileStartUrl(provider: 'google' | 'apple', redirectUri: string): string {
  return `${baseUrl()}/api/auth/mobile/${provider}/start?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export const exchangeMobileCode = (code: string): Promise<{ token: string }> =>
  request('/api/auth/mobile/exchange', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

// ------------------------------------------------------------ billing -----

export interface BillingConfig {
  purchaseAvailable: boolean;
  priceLabel: string;
  webUrl: string | null;
}

export const fetchBillingConfig = (): Promise<BillingConfig> => request('/api/billing/config');

export interface Entitlement {
  userId: string;
  allowed: boolean;
  reason: 'subscribed' | 'within_allowance' | 'exhausted' | 'no_account';
  subscribed: boolean;
  status: string;
  provider: string | null;
  allowance: number;
  used: number;
  enforced: boolean;
}

export const fetchEntitlement = (): Promise<{ entitlement: Entitlement | null }> =>
  request('/api/billing/status');

// ------------------------------------------------------------ recipes -----

export interface ExtractMeta {
  cached: boolean;
  source: 'url' | 'text' | 'file';
  extraction?: 'jsonld' | 'text';
  attempts?: number;
  repaired?: string[];
}

export interface ExtractResult {
  recipe: Recipe;
  meta?: ExtractMeta;
}

const extractPost = (body: unknown): Promise<ExtractResult> =>
  request('/api/recipes/extract', { method: 'POST', body: JSON.stringify(body) });

export const extractFromUrl = (url: string) => extractPost({ url });
export const extractFromText = (text: string) => extractPost({ text });
export const extractFromFile = (data: string, mediaType: string) =>
  extractPost({ file: { data, mediaType } });

export const reextract = (url: string): Promise<{ recipe: Recipe }> =>
  request('/api/recipes/reextract', { method: 'POST', body: JSON.stringify({ url }) });

export interface SearchResult {
  title: string;
  url: string;
  site: string;
  note: string;
  cached?: boolean;
}

export const searchRecipes = (query: string): Promise<{ results: SearchResult[] }> =>
  request('/api/recipes/search', { method: 'POST', body: JSON.stringify({ query }) });

// ------------------------------------------------------------ library -----

/** Absolute end time (epoch ms), never a countdown. */
export interface StepTimer {
  stepId: string;
  endsAt: number;
}

export interface Entry {
  id: string;
  recipe: Recipe;
  done: string[];
  servings: number | null;
  mode: 'diagram' | 'steps';
  timer: StepTimer | null;
  cooked: number[];
  rating: number | null;
  order: OrderPreference | null;
  version: number;
  savedAt: number;
}

export const loadLibrary = (): Promise<{ entries: Entry[] }> => request('/api/library');

export const createEntry = (entry: {
  id: string;
  recipe: Recipe;
  done?: string[];
  servings?: number | null;
  mode?: 'diagram' | 'steps';
  timer?: StepTimer | null;
}): Promise<{ entry: Entry }> =>
  request('/api/library', { method: 'POST', body: JSON.stringify(entry) });

export const patchEntry = (
  id: string,
  patch: Partial<{
    recipe: Recipe;
    done: string[];
    servings: number | null;
    mode: 'diagram' | 'steps';
    timer: StepTimer | null;
    cooked: number[];
    rating: number | null;
    order: OrderPreference | null;
    ifVersion: number;
  }>
): Promise<{ entry: Entry }> =>
  request(`/api/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteEntry = (id: string): Promise<{ ok: true }> =>
  request(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function newEntryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
