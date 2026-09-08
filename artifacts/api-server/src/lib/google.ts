/**
 * server/lib/google.ts — Google's half of the OAuth handshake.
 *
 * Authorization-code flow with PKCE. Endpoints are hardcoded rather than
 * fetched from the discovery document: they have been stable for a decade,
 * and one fewer network call on the sign-in path is one fewer thing that can
 * be down when someone is trying to sign in.
 *
 * Every value here that has to match something in the Google Cloud console is
 * marked. See docs/google-oauth.md for the console side.
 */

import crypto from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** MUST match the redirect URI registered in the console, exactly. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/** openid gets us an id_token; email and profile are both non-sensitive, so
 *  this scope set does not require Google verification to publish. */
const SCOPES = "openid email profile";

/** Google's iss is one of these two spellings, historically both in use. */
const VALID_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Tolerance for clock skew when checking exp. */
const SKEW_MS = 60_000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The public origin this app is reached at — scheme and host, no trailing
 * slash. Required rather than derived from the Host header, because the
 * redirect_uri must match the console byte for byte and a spoofable header is
 * no basis for that.
 */
export function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** null when Google sign-in is not configured, so callers can 503 cleanly
 *  and the client can hide the button rather than offering a broken one. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const base = publicBaseUrl();
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}${GOOGLE_CALLBACK_PATH}` };
}

// ------------------------------------------------------------------ PKCE ---

export function newCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function codeChallengeOf(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/**
 * The nonce is derived from the state rather than stored beside it.
 *
 * state is 32 random bytes, so sha256(state) is equally unguessable to anyone
 * who does not already hold the state — and deriving it means the callback
 * can recompute the expected nonce from what it already has, with no extra
 * column and no second lookup to get out of sync with the first.
 */
export function nonceForState(state: string): string {
  return crypto.createHash("sha256").update(`nonce:${state}`).digest("base64url");
}

// ------------------------------------------------------------------- flow ---

export function buildAuthUrl(
  cfg: GoogleConfig,
  opts: { state: string; codeVerifier: string }
): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", nonceForState(opts.state));
  url.searchParams.set("code_challenge", codeChallengeOf(opts.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // We only ever read identity claims out of the id_token, so there is no
  // refresh token to want and no reason to ask for offline access.
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

/**
 * Trades the code for an id_token and returns the identity in it.
 *
 * The id_token's signature is deliberately not verified. This exchange is a
 * direct server-to-server POST to Google's token endpoint over TLS, so the
 * token's provenance is established by the channel it arrived on — Google's
 * own documentation says validation may be skipped in exactly this case. The
 * claims that do not follow from the channel are still checked below: issuer,
 * audience, expiry and nonce.
 *
 * If an id_token is ever accepted from the *client* instead — a native app,
 * Google One Tap — that reasoning evaporates and this must verify RS256
 * against https://www.googleapis.com/oauth2/v3/certs before trusting anything.
 */
export async function exchangeCode(
  cfg: GoogleConfig,
  opts: { code: string; codeVerifier: string; state: string }
): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      typeof body.error_description === "string"
        ? body.error_description
        : typeof body.error === "string"
          ? body.error
          : `HTTP ${res.status}`;
    throw new Error(`Google rejected the authorization code: ${detail}`);
  }

  const idToken = body.id_token;
  if (typeof idToken !== "string") throw new Error("Google returned no id_token.");

  const claims = decodeJwtPayload(idToken);

  if (typeof claims.iss !== "string" || !VALID_ISSUERS.has(claims.iss)) {
    throw new Error("id_token has the wrong issuer.");
  }
  if (claims.aud !== cfg.clientId) {
    throw new Error("id_token was issued for a different client.");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 + SKEW_MS < Date.now()) {
    throw new Error("id_token has expired.");
  }
  if (claims.nonce !== nonceForState(opts.state)) {
    throw new Error("id_token nonce does not match this sign-in attempt.");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("id_token has no subject.");
  }

  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
    displayName:
      typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("id_token is not a JWT.");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("id_token payload is not readable JSON.");
  }
}
