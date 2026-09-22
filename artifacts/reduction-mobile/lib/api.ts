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

/**
 * How long a request may hang before it is treated as the network failing.
 * Without this a phone on one bar waits for the OS to give up — on the
 * order of a minute — with a checkmark on screen that may then revert. With
 * it, a hung write becomes a bare Error (no HTTP status), which the sync
 * engine reads as "offline" and keeps for its window. Reads are bounded by
 * the same number: a library fetch that has not answered in this long is
 * not going to.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The exceptions to it, and why each one is an exception.
 *
 * The ceiling above is sized for a read or a write — work the server does
 * in milliseconds. Three routes do not fit that shape, and pointing the
 * same 15s at them cut good work off mid-flight: an extraction is a model
 * call the UI already presents as a 10-30 second wait (ExtractionProgress
 * walks five three-second stages), so a slow page or a retried parse
 * reached the ceiling routinely and the person saw a failure for a request
 * that was still working. A timeout has to be a number only a dead
 * connection reaches, per route, or it is a second failure mode rather than
 * a safety net.
 */
export const EXTRACTION_TIMEOUT_MS = 120_000;

/** A web search is one upstream call plus its cache write: slower than a
 *  library read, far quicker than an extraction. */
export const SEARCH_TIMEOUT_MS = 45_000;

/** A photo is fetched from the recipe's page and re-encoded (jimp) before
 *  the route answers, so the wait is someone else's server plus ours. */
export const PHOTO_TIMEOUT_MS = 60_000;

async function request(path: string, init?: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, headers, signal: controller.signal });
  } catch (e) {
    // Our own timer fired — whatever the platform calls the exception it
    // raises. Web and Node throw `AbortError`; expo/fetch's native
    // implementation throws `FetchRequestCanceledException` with a Swift
    // file and line in the message, which reached the screen verbatim while
    // this branch tested the name. The flag is the only reliable test,
    // and this controller is aborted from nowhere else.
    //
    // No status on purpose: the sync engine keys "offline" on its absence.
    // An aborted write may still have reached the server; the retry then
    // 409s against its own commit and merges, which is the safe outcome.
    if (timedOut || (e as Error)?.name === 'AbortError') throw new Error('The request timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

/** Which providers the server is configured for, so the sign-in screen
 *  offers only buttons that work (the web asks the same route first). */
export const fetchProviders = (): Promise<{ providers: { google: boolean; apple: boolean } }> =>
  request('/api/auth/providers');

export const signOutServer = (): Promise<void> =>
  request('/api/auth/logout', { method: 'POST' }).catch(() => {});

/** What the server did about the subscription while deleting the account:
 *  `cancelled` names providers it stopped, `manual` the ones only the person
 *  can stop (the App Store). Provider names are for the sentence shown,
 *  never for branching. */
export interface DeleteAccountResult {
  ok: true;
  cancelled: string[];
  manual: string[];
}

/** Delete the signed-in account, its recipes and its subscription rows.
 *  Rejects — with the server's sentence — when billing could not be
 *  stopped, in which case NOTHING was deleted (routes/account.ts). */
export const deleteAccount = (): Promise<DeleteAccountResult> =>
  request('/api/account', { method: 'DELETE' });

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
  /** True only when the server can verify and record a store purchase.
   *  The app must not sell when this is false: the money would be taken
   *  and nothing unlocked until the server was configured. */
  nativePurchaseAvailable?: boolean;
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

/** After a purchase or a restore: StoreKit 2's signed transaction, which
 *  the server verifies against Apple's roots and binds to this account.
 *  Refusals carry the server's sentence (wrong account, unverifiable). */
export const verifyApplePurchase = (body: { signedTransactionInfo: string; signedRenewalInfo?: string }): Promise<{ ok: true; entitlement: Entitlement }> =>
  request('/api/billing/apple/verify', { method: 'POST', body: JSON.stringify(body) });

/** "N recipes free". A refused code comes back as an ApiError with the
 *  server's own sentence (unknown, expired, fully claimed, already used). */
export const redeemCoupon = (code: string): Promise<{ ok: true; recipes: number; entitlement: Entitlement }> =>
  request('/api/billing/coupon', { method: 'POST', body: JSON.stringify({ code }) });

// --------------------------------------------------------------- push -----

/** The native arm of POST /api/push/subscribe: an Expo push token in place
 *  of a web subscription. The server checks the shape strictly (422). */
export const subscribePush = (expoPushToken: string, userAgent: string): Promise<{ ok: true }> =>
  request('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ expoPushToken, userAgent }) });

/** Scoped to the account server-side, so a leaked token cannot silence
 *  someone else's phone. */
export const unsubscribePush = (endpoint: string): Promise<{ ok: true }> =>
  request('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

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
  request('/api/recipes/extract', { method: 'POST', body: JSON.stringify(body) }, EXTRACTION_TIMEOUT_MS);

export const extractFromUrl = (url: string) => extractPost({ url });
export const extractFromText = (text: string) => extractPost({ text });
export const extractFromFile = (data: string, mediaType: string) =>
  extractPost({ file: { data, mediaType } });

export const reextract = (url: string): Promise<{ recipe: Recipe }> =>
  request('/api/recipes/reextract', { method: 'POST', body: JSON.stringify({ url }) }, EXTRACTION_TIMEOUT_MS);

export interface SearchResult {
  title: string;
  url: string;
  site: string;
  note: string;
  cached?: boolean;
}

export const searchRecipes = (query: string): Promise<{ results: SearchResult[] }> =>
  request('/api/recipes/search', { method: 'POST', body: JSON.stringify({ query }) }, SEARCH_TIMEOUT_MS);

// ------------------------------------------------------------ library -----

/** Absolute end time (epoch ms), never a countdown. */
export interface StepTimer {
  stepId: string;
  endsAt: number;
}

/** The card's picture, as the list describes it: which version is stored
 *  and where it came from. The bytes are at `photoUrl`. Server-owned —
 *  never in a PATCH, never merged; see lib/syncEngine.ts. */
export interface PhotoMeta {
  version: number;
  source: 'page' | 'user';
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
  photo?: PhotoMeta | null;
}

/** The photo's URL for an <Image>: private, so it needs the bearer token
 *  as a header (`photoHeaders`), and versioned, so it can be cached for
 *  ever. */
export const photoUrl = (id: string, version: number): string =>
  `${baseUrl()}/api/library/${encodeURIComponent(id)}/photo?v=${version}`;

export const photoHeaders = (): Record<string, string> =>
  authToken ? { Authorization: `Bearer ${authToken}` } : {};

/** Attach the person's own photo (already shrunk by lib/photo.ts). */
export const uploadPhoto = (id: string, base64: string, mediaType: string): Promise<{ photo: PhotoMeta }> =>
  request(
    `/api/library/${encodeURIComponent(id)}/photo`,
    { method: 'PUT', body: JSON.stringify({ data: base64, mediaType }) },
    PHOTO_TIMEOUT_MS
  );

export const removePhoto = (id: string): Promise<{ photo: null }> =>
  request(`/api/library/${encodeURIComponent(id)}/photo`, { method: 'DELETE' });

/** Ask the server to fetch the source page's picture now — the self-healing
 *  half of the capture at save. `photo` is null when the page had none
 *  worth keeping; the route 404s with `no_source_image` when the recipe
 *  has no URL at all. */
export const fetchPhotoFromSource = (id: string): Promise<{ photo: PhotoMeta | null }> =>
  request(`/api/library/${encodeURIComponent(id)}/photo/from-source`, { method: 'POST' }, PHOTO_TIMEOUT_MS);

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
