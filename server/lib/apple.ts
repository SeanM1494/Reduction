/**
 * server/lib/apple.ts — Sign in with Apple.
 *
 * Deliberately the same shape as google.ts, because the two flows are the
 * same OAuth dance and gratuitous differences between them are how one of
 * them quietly stops being maintained. Four things genuinely differ, and each
 * is the source of its own class of bug:
 *
 *  1. THE CLIENT SECRET IS A JWT YOU SIGN YOURSELF, not a fixed string. It is
 *     an ES256 assertion signed with the .p8 key, valid for at most six
 *     months, and it is minted here rather than stored — see clientSecret().
 *  2. THE CALLBACK IS A POST, not a GET, because `response_mode=form_post` is
 *     required whenever the `name` or `email` scope is requested. That needs
 *     a urlencoded body parser, mounted on that one route.
 *  3. THE NAME ARRIVES EXACTLY ONCE, on the very first authorization, in the
 *     form body rather than the id_token — and never again, for that Apple ID
 *     and this Services ID, for ever. Not persisting it there means it is
 *     gone; re-authorizing does not bring it back unless the user first
 *     removes the app from their Apple ID settings.
 *  4. THE EMAIL MAY BE A RELAY ADDRESS (@privaterelay.appleid.com) when the
 *     user chooses to hide it. That is exactly why shared/schema.ts forbids
 *     looking accounts up by email: it is display-only here too.
 */

import crypto from "node:crypto";

const AUTH_ENDPOINT = "https://appleid.apple.com/auth/authorize";
const TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token";

export const APPLE_CALLBACK_PATH = "/api/auth/apple/callback";

/**
 * `name email` triggers Apple's form_post requirement. Asked for anyway: an
 * account with no name at all makes for a bleak Settings screen, and the one
 * chance to get it is the first authorization.
 */
const SCOPES = "name email";

const VALID_ISSUER = "https://appleid.apple.com";
const SKEW_MS = 60_000;

export interface AppleConfig {
  /** The SERVICES ID (com.example.appservices), not the App ID or bundle id.
   *  It is the OAuth client_id and the id_token audience. */
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  redirectUri: string;
}

/**
 * Normalises the .p8 as pasted into a secret.
 *
 * Two shapes reach here and both must work. A multiline paste arrives with
 * real newlines. A single-line paste — which is what happens when the key
 * goes through a .env file, a shell export, or anything that flattens it —
 * arrives with literal backslash-n. Accepting only the first means the key
 * looks present, `createPrivateKey` throws something opaque about ASN.1, and
 * the failure looks like a bad key rather than a bad paste.
 */
const PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const PEM_FOOTER = "-----END PRIVATE KEY-----";

/**
 * Rebuilds a PEM from whatever survived the paste.
 *
 * A .p8 makes a long journey to get here — a text editor, a clipboard, a web
 * form, sometimes a shell — and each leg can damage it in a way that leaves it
 * looking fine. Every transform below is for damage seen in the wild:
 *
 *  - a UTF-8 BOM prepended by a Windows editor, invisible everywhere
 *  - the whole value wrapped in quotes, from copying a line out of a .env
 *  - CRLF line endings, which OpenSSL will not accept inside the base64
 *  - literal backslash-n, from anything that flattens a multiline value
 *  - NEWLINES REMOVED ENTIRELY, which several secret-management UIs do to
 *    "tidy" a pasted value. This is the nastiest one, because the header and
 *    footer are still there and the value looks completely correct to a human
 *    reading it back.
 *
 * The last case is why this reconstructs rather than merely cleans: given the
 * header, the footer and the base64 between them, the original file is
 * recoverable exactly — PEM line breaks are formatting, not data. So the
 * body is extracted, stripped of all whitespace, and re-wrapped at 64
 * characters.
 *
 * What it will NOT do is guess at a value with no PEM markers at all. A bare
 * base64 blob might be a PKCS#8 key or might be half a file, and silently
 * treating one as the other trades a clear failure for a confusing one.
 */
function normalisePem(raw: string): string {
  let s = raw;

  // BOM first: it hides in front of the header and defeats every startsWith.
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  s = s.trim();

  // A value copied out of a .env file or a JSON blob, quotes and all.
  if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }

  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (s.includes("\\r")) s = s.replace(/\\r/g, "");
  s = s.replace(/\r\n?/g, "\n");

  const start = s.indexOf(PEM_HEADER);
  const end = s.indexOf(PEM_FOOTER);
  if (start === -1 || end === -1 || end < start) return s;

  const body = s.slice(start + PEM_HEADER.length, end).replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? "";
  return `${PEM_HEADER}\n${wrapped}\n${PEM_FOOTER}\n`;
}

/**
 * What actually landed in APPLE_PRIVATE_KEY, without disclosing it.
 *
 * Exists because "privateKeyParses: false" is the same unhelpful answer as the
 * `invalid_client` it was meant to replace — it says the value is wrong
 * without saying how, and a paste that looks right when read back can be
 * wrong in half a dozen invisible ways. Every field here is chosen to be
 * diagnostic without being useful to anyone who obtains it.
 *
 * The 15-character samples are the PEM's boilerplate: "-----BEGIN PRIV" and
 * "E KEY-----" are fixed strings in every PKCS#8 file. If the markers are
 * missing the sample instead shows the ASN.1 prefix, which is structure
 * rather than key material — the private scalar sits well inside the body,
 * far from either end.
 */
export interface KeyEnvReport {
  present: boolean;
  chars: number;
  bytes: number;
  first15: string;
  last15: string;
  hasLiteralBackslashN: boolean;
  hasRealNewlines: boolean;
  realNewlineCount: number;
  hasCarriageReturns: boolean;
  hasBom: boolean;
  isQuoted: boolean;
  startsWithHeader: boolean;
  endsWithFooter: boolean;
  /** An editor that "helpfully" turns ----- into an em-dash breaks the file
   *  in a way that is genuinely invisible in most fonts. */
  hasSmartPunctuation: boolean;
  /** Anything outside printable ASCII, which a valid PEM never contains. */
  nonAsciiCount: number;
  /** Leading character codes, so an invisible character is nameable. */
  firstCharCodes: number[];
  normalisedParses: boolean;
  parseError: string | null;
  /** How the raw value differs from what is actually handed to OpenSSL. */
  repairs: string[];
}

export function describeKeyEnv(raw: string | undefined): KeyEnvReport {
  if (raw === undefined || raw === "") {
    return {
      present: false, chars: 0, bytes: 0, first15: "", last15: "",
      hasLiteralBackslashN: false, hasRealNewlines: false, realNewlineCount: 0,
      hasCarriageReturns: false, hasBom: false, isQuoted: false,
      startsWithHeader: false, endsWithFooter: false, hasSmartPunctuation: false,
      nonAsciiCount: 0, firstCharCodes: [], normalisedParses: false,
      parseError: "APPLE_PRIVATE_KEY is unset or empty.", repairs: [],
    };
  }

  const trimmed = raw.trim();
  const repairs: string[] = [];
  if (raw.charCodeAt(0) === 0xfeff) repairs.push("stripped a UTF-8 BOM");
  if (raw !== trimmed) repairs.push("trimmed surrounding whitespace");
  const isQuoted =
    trimmed.length > 1 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  if (isQuoted) repairs.push("removed surrounding quotes");
  if (raw.includes("\\n")) repairs.push("converted literal \\n to newlines");
  if (/\r/.test(raw)) repairs.push("converted CRLF to LF");

  const normalised = normalisePem(raw);
  if (
    raw.includes(PEM_HEADER) &&
    !/\n/.test(raw.slice(raw.indexOf(PEM_HEADER) + PEM_HEADER.length, raw.indexOf(PEM_FOOTER) > 0 ? raw.indexOf(PEM_FOOTER) : undefined)) &&
    !raw.includes("\\n")
  ) {
    repairs.push("re-wrapped a body that had no line breaks at all");
  }

  let normalisedParses = false;
  let parseError: string | null = null;
  try {
    crypto.createPrivateKey(normalised);
    normalisedParses = true;
  } catch (e) {
    parseError = (e as Error).message;
  }

  return {
    present: true,
    chars: raw.length,
    // Differs from `chars` exactly when something non-ASCII crept in.
    bytes: Buffer.byteLength(raw, "utf8"),
    first15: raw.slice(0, 15),
    last15: raw.slice(-15),
    hasLiteralBackslashN: raw.includes("\\n"),
    hasRealNewlines: raw.includes("\n"),
    realNewlineCount: (raw.match(/\n/g) ?? []).length,
    hasCarriageReturns: /\r/.test(raw),
    hasBom: raw.charCodeAt(0) === 0xfeff,
    isQuoted,
    startsWithHeader: trimmed.replace(/^["']/, "").startsWith(PEM_HEADER),
    endsWithFooter: trimmed.replace(/["']$/, "").endsWith(PEM_FOOTER),
    // U+2013/2014 en and em dash, and the four curly quotes.
    hasSmartPunctuation: /[\u2010-\u2015\u2018\u2019\u201c\u201d]/.test(raw),
    nonAsciiCount: (raw.match(/[^\x20-\x7e\n\r\t]/g) ?? []).length,
    firstCharCodes: [...raw.slice(0, 6)].map((c) => c.charCodeAt(0)),
    normalisedParses,
    parseError,
    repairs,
  };
}

/** null when Apple sign-in is not configured, so callers can 503 cleanly and
 *  the client can hide the button rather than offering a broken one. */
export function appleConfig(): AppleConfig | null {
  const clientId = process.env.APPLE_CLIENT_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  const rawKey = process.env.APPLE_PRIVATE_KEY;
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!clientId || !teamId || !keyId || !rawKey || !base) return null;
  return {
    clientId,
    teamId,
    keyId,
    privateKeyPem: normalisePem(rawKey),
    redirectUri: `${base}${APPLE_CALLBACK_PATH}`,
  };
}

// --------------------------------------------------------- client secret ---

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url").replace(/=+$/, "");

/**
 * Apple caps the assertion at six months. Ninety days is well inside that and
 * long enough that the cache below effectively never expires in a process
 * that restarts on every deploy — the expiry exists so a very long-lived
 * process cannot drift into presenting a stale secret.
 */
const SECRET_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Re-mint this long before expiry, so an in-flight request never races it. */
const REFRESH_BEFORE_MS = 60 * 60 * 1000;

let cached: { token: string; expiresAt: number; keyId: string } | null = null;

/**
 * The ES256 client secret, minted on demand and cached until it nears expiry.
 *
 * NOT STORED ANYWHERE. It is derived from the .p8 in a few hundred
 * microseconds, so persisting it would add a rotation problem, a staleness
 * problem and a second copy of a credential, to save nothing. Regenerating on
 * boot is strictly simpler and strictly safer.
 *
 * THE dsaEncoding OPTION IS THE WHOLE THING. Node's default ECDSA output is
 * DER (an ASN.1 SEQUENCE of two INTEGERs, variable length); JWS ES256
 * requires the raw r||s concatenation, fixed at 64 bytes — IEEE P1363. Omit
 * it and Node signs happily, the JWT looks perfectly well-formed, and Apple
 * returns `invalid_client` with no hint as to why. That single option is the
 * difference between a working integration and an afternoon.
 */
export function clientSecret(cfg: AppleConfig, now = Date.now()): string {
  // Keyed on keyId too, so rotating the key in Secrets takes effect on the
  // next call rather than being masked by a cache from the previous one.
  if (cached && cached.keyId === cfg.keyId && cached.expiresAt - REFRESH_BEFORE_MS > now) {
    return cached.token;
  }

  const iat = Math.floor(now / 1000);
  const exp = Math.floor((now + SECRET_TTL_MS) / 1000);

  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const payload = {
    iss: cfg.teamId,
    iat,
    exp,
    aud: VALID_ISSUER,
    // The Services ID. Apple checks this against the key's registered client.
    sub: cfg.clientId,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(cfg.privateKeyPem);
  } catch (e) {
    // Almost always a paste problem rather than a bad key — say so, because
    // the underlying error talks about ASN.1 and helps nobody.
    throw new Error(
      `APPLE_PRIVATE_KEY is not a readable PEM private key (${(e as Error).message}). ` +
        "Paste the whole .p8 file including the BEGIN and END lines."
    );
  }

  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });

  const token = `${signingInput}.${b64url(signature)}`;
  cached = { token, expiresAt: now + SECRET_TTL_MS, keyId: cfg.keyId };
  return token;
}

/** Test seam, and the thing to call after rotating the key by hand. */
export function resetClientSecretCache(): void {
  cached = null;
}

// ------------------------------------------------------------------- flow ---

/** Same derivation as Google's, for the same reason — see google.ts. */
export function nonceForState(state: string): string {
  return crypto.createHash("sha256").update(`nonce:${state}`).digest("base64url");
}

export function buildAuthUrl(cfg: AppleConfig, opts: { state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", nonceForState(opts.state));
  // Required whenever name or email is requested, and the reason the callback
  // is a POST. Apple rejects the request outright without it.
  url.searchParams.set("response_mode", "form_post");
  return url.toString();
}

export interface AppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Only ever non-null on the FIRST authorization. See the note at the top. */
  displayName: string | null;
  isPrivateRelay: boolean;
}

/**
 * The `user` field Apple posts alongside the code, exactly once.
 *
 * JSON in a form field, and absent on every subsequent sign-in. Malformed
 * input is swallowed rather than thrown: a name that will not parse must not
 * cost somebody their sign-in.
 */
export function parseUserField(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
    const first = parsed.name?.firstName?.trim() ?? "";
    const last = parsed.name?.lastName?.trim() ?? "";
    const full = `${first} ${last}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

/**
 * Trades the code for an id_token and returns the identity in it.
 *
 * As with Google, the id_token's signature is not verified: this is a direct
 * server-to-server POST to Apple's token endpoint over TLS, so provenance
 * comes from the channel. The claims that do NOT follow from the channel are
 * checked below — issuer, audience, expiry, nonce and subject.
 *
 * If an id_token is ever accepted from a CLIENT instead (a native app passing
 * one up from ASAuthorization), that reasoning evaporates and this must
 * verify ES256 against https://appleid.apple.com/auth/keys first.
 */
export async function exchangeCode(
  cfg: AppleConfig,
  opts: { code: string; state: string }
): Promise<AppleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: clientSecret(cfg),
      code: opts.code,
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
    // invalid_client here is nearly always the client secret: a wrong Team ID,
    // a Key ID that does not match the key, or DER-encoded signature bytes.
    throw new Error(`Apple rejected the authorization code: ${detail}`);
  }

  const idToken = body.id_token;
  if (typeof idToken !== "string") throw new Error("Apple returned no id_token.");

  const claims = decodeJwtPayload(idToken);

  if (claims.iss !== VALID_ISSUER) throw new Error("id_token has the wrong issuer.");
  if (claims.aud !== cfg.clientId)
    throw new Error("id_token was issued for a different client.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 + SKEW_MS < Date.now())
    throw new Error("id_token has expired.");
  if (claims.nonce !== nonceForState(opts.state))
    throw new Error("id_token nonce does not match this sign-in attempt.");
  if (typeof claims.sub !== "string" || !claims.sub)
    throw new Error("id_token has no subject.");

  const email = typeof claims.email === "string" ? claims.email : null;

  return {
    subject: claims.sub,
    email,
    // Apple sends this as a boolean or the STRING "true", depending on the
    // claim and the day. Both mean verified.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    displayName: null,
    isPrivateRelay:
      claims.is_private_email === true ||
      claims.is_private_email === "true" ||
      (email?.endsWith("@privaterelay.appleid.com") ?? false),
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
