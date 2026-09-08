/**
 * server/lib/apple.test.ts — the client secret, and the parsing around it.
 *
 * The client secret gets the most attention here because it is the part that
 * fails SILENTLY: a JWT signed with Node's default DER encoding is perfectly
 * well-formed, passes every structural check, and is rejected by Apple with
 * `invalid_client` and no further explanation. Nothing local catches it. So
 * the signature encoding is asserted directly, in bytes.
 *
 * A generated throwaway P-256 key is used rather than the real one: these
 * assertions are about shape, not about a particular key, and a test suite is
 * not a place to keep a signing credential.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  APPLE_CALLBACK_PATH,
  appleConfig,
  buildAuthUrl,
  clientSecret,
  describeKeyEnv,
  nonceForState,
  parseUserField,
  resetClientSecretCache,
} from "./apple";

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CFG = {
  clientId: "com.example.appservices",
  teamId: "TEAMID1234",
  keyId: "KEYID56789",
  privateKeyPem: PEM,
  redirectUri: `https://example.test${APPLE_CALLBACK_PATH}`,
};

const parts = (jwt: string) => jwt.split(".");
const decode = (seg: string) => JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));

test("the client secret is an ES256 JWT with the header Apple requires", () => {
  resetClientSecretCache();
  const [h, p, sig] = parts(clientSecret(CFG));
  const header = decode(h);
  assert.equal(header.alg, "ES256");
  assert.equal(header.typ, "JWT");
  // kid identifies WHICH key signed it; without it Apple cannot pick one.
  assert.equal(header.kid, CFG.keyId);
  assert.ok(sig.length > 0);
});

test("the claims are the four Apple checks, and the right way round", () => {
  resetClientSecretCache();
  const payload = decode(parts(clientSecret(CFG))[1]);
  // The two that are easy to swap, and which produce invalid_client when you
  // do: iss is the TEAM, sub is the SERVICES ID.
  assert.equal(payload.iss, CFG.teamId);
  assert.equal(payload.sub, CFG.clientId);
  assert.equal(payload.aud, "https://appleid.apple.com");
  assert.ok(payload.exp > payload.iat);
});

test("expiry is inside Apple's six-month cap", () => {
  resetClientSecretCache();
  const payload = decode(parts(clientSecret(CFG))[1]);
  const days = (payload.exp - payload.iat) / 86400;
  assert.ok(days > 1, "a secret that expires immediately is useless");
  // Apple rejects anything beyond 6 months outright.
  assert.ok(days <= 180, `${days} days exceeds Apple's cap`);
});

test("THE SIGNATURE IS P1363, NOT DER — 64 bytes, r||s", () => {
  resetClientSecretCache();
  const sig = Buffer.from(parts(clientSecret(CFG))[2], "base64url");
  // JWS ES256 is a fixed 64 bytes: two 32-byte integers concatenated. Node's
  // DEFAULT for ECDSA is DER, which is ~70-72 bytes and variable-length, and
  // produces a JWT that looks fine everywhere except at Apple.
  assert.equal(sig.length, 64, "dsaEncoding: 'ieee-p1363' is missing or wrong");
});

test("and the default encoding really would differ, so that option is load-bearing", () => {
  const input = Buffer.from("proof");
  const der = crypto.sign("sha256", input, privateKey);
  const p1363 = crypto.sign("sha256", input, { key: privateKey, dsaEncoding: "ieee-p1363" });
  assert.notEqual(der.length, p1363.length);
  assert.equal(p1363.length, 64);
});

test("the signature verifies against the key that made it", () => {
  resetClientSecretCache();
  const [h, p, sig] = parts(clientSecret(CFG));
  const ok = crypto.verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: crypto.createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
    Buffer.from(sig, "base64url")
  );
  assert.equal(ok, true);
});

test("segments are base64url with no padding", () => {
  resetClientSecretCache();
  const jwt = clientSecret(CFG);
  assert.equal(parts(jwt).length, 3);
  // '+', '/' or '=' anywhere means base64 leaked in where base64url belongs,
  // and the JWT will be rejected or mangled in transit.
  assert.equal(/[+/=]/.test(jwt), false);
});

test("it is cached rather than re-signed on every call", () => {
  resetClientSecretCache();
  const a = clientSecret(CFG, 1_000_000_000_000);
  const b = clientSecret(CFG, 1_000_000_060_000);
  assert.equal(a, b);
});

test("it is re-minted before it expires, not after", () => {
  resetClientSecretCache();
  const t0 = 1_000_000_000_000;
  const a = clientSecret(CFG, t0);
  // 89 days on: inside the 90-day life, but within the refresh window, so a
  // fresh one is issued rather than one that could expire mid-request.
  const b = clientSecret(CFG, t0 + 89.99 * 24 * 3600 * 1000);
  assert.notEqual(a, b);
});

test("rotating the key id busts the cache", () => {
  resetClientSecretCache();
  const a = clientSecret(CFG, 1_000_000_000_000);
  const b = clientSecret({ ...CFG, keyId: "ROTATED123" }, 1_000_000_001_000);
  assert.notEqual(a, b);
  assert.equal(decode(parts(b)[0]).kid, "ROTATED123");
});

test("a PEM flattened to one line still works", () => {
  // What happens when the key goes through a .env file or a shell export.
  const saved = { ...process.env };
  process.env.APPLE_CLIENT_ID = CFG.clientId;
  process.env.APPLE_TEAM_ID = CFG.teamId;
  process.env.APPLE_KEY_ID = CFG.keyId;
  process.env.APPLE_PRIVATE_KEY = PEM.replace(/\n/g, "\\n");
  process.env.PUBLIC_BASE_URL = "https://example.test";
  try {
    resetClientSecretCache();
    const cfg = appleConfig();
    assert.ok(cfg, "a single-line key must still resolve");
    assert.equal(parts(clientSecret(cfg!)).length, 3);
  } finally {
    process.env = saved;
    resetClientSecretCache();
  }
});

test("a key that is not a PEM says so in words a human can act on", () => {
  resetClientSecretCache();
  assert.throws(
    () => clientSecret({ ...CFG, privateKeyPem: "not-a-key" }),
    /APPLE_PRIVATE_KEY is not a readable PEM/
  );
});

test("config is absent unless every part of it is present", () => {
  const saved = { ...process.env };
  const full = {
    APPLE_CLIENT_ID: CFG.clientId,
    APPLE_TEAM_ID: CFG.teamId,
    APPLE_KEY_ID: CFG.keyId,
    APPLE_PRIVATE_KEY: PEM,
    PUBLIC_BASE_URL: "https://example.test",
  };
  try {
    for (const missing of Object.keys(full)) {
      process.env = { ...saved, ...full };
      delete process.env[missing];
      // Half-configured must read as unconfigured: the button hides and the
      // route 503s, rather than the flow failing at Apple.
      assert.equal(appleConfig(), null, `missing ${missing} should disable Apple`);
    }
    process.env = { ...saved, ...full };
    const cfg = appleConfig();
    assert.ok(cfg);
    assert.equal(cfg!.redirectUri, `https://example.test${APPLE_CALLBACK_PATH}`);
  } finally {
    process.env = saved;
  }
});

test("a trailing slash on the base URL does not double up in the redirect", () => {
  const saved = { ...process.env };
  try {
    process.env.APPLE_CLIENT_ID = CFG.clientId;
    process.env.APPLE_TEAM_ID = CFG.teamId;
    process.env.APPLE_KEY_ID = CFG.keyId;
    process.env.APPLE_PRIVATE_KEY = PEM;
    process.env.PUBLIC_BASE_URL = "https://example.test///";
    // Apple matches redirect_uri byte for byte against the registered value,
    // so a stray slash is a failed sign-in rather than a cosmetic problem.
    assert.equal(appleConfig()!.redirectUri, `https://example.test${APPLE_CALLBACK_PATH}`);
  } finally {
    process.env = saved;
  }
});

test("the authorize URL carries form_post, which the name scope requires", () => {
  const url = new URL(buildAuthUrl(CFG, { state: "abc123" }));
  assert.equal(url.origin + url.pathname, "https://appleid.apple.com/auth/authorize");
  // Without response_mode=form_post, Apple refuses the request outright when
  // name or email is in scope.
  assert.equal(url.searchParams.get("response_mode"), "form_post");
  assert.equal(url.searchParams.get("scope"), "name email");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), CFG.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), CFG.redirectUri);
  assert.equal(url.searchParams.get("state"), "abc123");
  assert.equal(url.searchParams.get("nonce"), nonceForState("abc123"));
});

test("the nonce is derived from the state and is not the state", () => {
  assert.notEqual(nonceForState("s"), "s");
  assert.equal(nonceForState("s"), nonceForState("s"));
  assert.notEqual(nonceForState("a"), nonceForState("b"));
});

test("the name is read from the user field, and only when there is one", () => {
  assert.equal(
    parseUserField('{"name":{"firstName":"Ada","lastName":"Lovelace"},"email":"a@b.c"}'),
    "Ada Lovelace"
  );
  assert.equal(parseUserField('{"name":{"firstName":"Prince"}}'), "Prince");
  assert.equal(parseUserField('{"name":{"lastName":"Solo"}}'), "Solo");
});

test("a missing, empty or malformed user field costs nobody their sign-in", () => {
  // Every later sign-in sends nothing at all — this is the normal case, not
  // an error, and must never throw.
  for (const bad of [undefined, null, "", "   ", "{", "[]", "{}", '{"name":{}}', 42, {}]) {
    assert.equal(parseUserField(bad), null, `${JSON.stringify(bad)} should be null`);
  }
});

// ---------------------------------------------------------------------------
// What actually lands in APPLE_PRIVATE_KEY.
//
// A .p8 makes a long journey to reach an env var — editor, clipboard, web
// form, sometimes a shell — and each leg can damage it in a way that is
// invisible when the value is read back. These are the manglings seen in the
// wild; the ones that CAN be recovered are, and the ones that cannot are
// named rather than reported as a generic parse failure.
// ---------------------------------------------------------------------------

const parses = (v: string) => describeKeyEnv(v).normalisedParses;
const PEM_TRIM = PEM.trim();

test("a pristine key parses, and its samples are boilerplate rather than key", () => {
  const r = describeKeyEnv(PEM);
  assert.equal(r.normalisedParses, true);
  // The 15-character windows land on fixed PKCS#8 text in every key file, so
  // they identify a mangled paste without disclosing anything.
  assert.equal(r.first15, "-----BEGIN PRIV");
  // Asserted loosely on purpose: whether the file ends with a newline shifts
  // this window, and that variation is a thing the report should SHOW rather
  // than something to pin. A trailing newline is harmless and common.
  assert.match(r.last15, /KEY-----\n?$/);
  assert.equal(describeKeyEnv(PEM_TRIM).last15, "RIVATE KEY-----");
});

test("recovers the manglings that are recoverable", () => {
  assert.equal(parses(PEM_TRIM.replace(/\n/g, "\\n")), true, "literal backslash-n");
  assert.equal(parses(PEM_TRIM.replace(/\n/g, "\r\n")), true, "CRLF");
  assert.equal(parses("\uFEFF" + PEM_TRIM), true, "UTF-8 BOM");
  assert.equal(parses(`"${PEM_TRIM}"`), true, "wrapped in double quotes");
  assert.equal(parses(`'${PEM_TRIM}'`), true, "wrapped in single quotes");
  assert.equal(parses(PEM_TRIM + "\n\n   \n"), true, "trailing blank lines");
  // The nastiest one: several secret-management UIs "tidy" a pasted value by
  // stripping newlines. Header and footer survive, so it reads back as
  // completely correct — and OpenSSL refuses it. PEM line breaks are
  // formatting rather than data, so the original is recoverable exactly.
  assert.equal(parses(PEM_TRIM.replace(/\n/g, "")), true, "all newlines stripped");
  assert.equal(parses(PEM_TRIM.replace(/\n/g, " ")), true, "newlines became spaces");
});

test("names the manglings that are NOT recoverable", () => {
  // An editor turning ----- into an em-dash is genuinely invisible in most
  // fonts, so it gets its own flag rather than a generic parse error.
  const dashed = describeKeyEnv(PEM_TRIM.replace("-----BEGIN", "\u2014BEGIN"));
  assert.equal(dashed.normalisedParses, false);
  assert.equal(dashed.hasSmartPunctuation, true);
  assert.equal(dashed.startsWithHeader, false);

  const noHeader = describeKeyEnv(PEM_TRIM.split("\n").slice(1).join("\n"));
  assert.equal(noHeader.normalisedParses, false);
  assert.equal(noHeader.startsWithHeader, false);

  const truncated = describeKeyEnv(PEM_TRIM.slice(0, PEM_TRIM.length - 40));
  assert.equal(truncated.normalisedParses, false);
  assert.equal(truncated.endsWithFooter, false);
});

test("distinguishes literal backslash-n from real newlines", () => {
  // The single question the user could not answer from "privateKeyParses:
  // false", and the two cases look identical when read back in a form field.
  const literal = describeKeyEnv(PEM_TRIM.replace(/\n/g, "\\n"));
  assert.equal(literal.hasLiteralBackslashN, true);
  assert.equal(literal.hasRealNewlines, false);
  assert.equal(literal.realNewlineCount, 0);

  const real = describeKeyEnv(PEM);
  assert.equal(real.hasLiteralBackslashN, false);
  assert.equal(real.hasRealNewlines, true);
  assert.ok(real.realNewlineCount >= 4);
});

test("counts characters and bytes separately, so non-ASCII shows up", () => {
  const clean = describeKeyEnv(PEM_TRIM);
  assert.equal(clean.chars, clean.bytes, "pure ASCII: the two agree");
  assert.equal(clean.nonAsciiCount, 0);

  const dirty = describeKeyEnv("\uFEFF" + PEM_TRIM);
  // A BOM is one character and three bytes — which is how an invisible
  // prefix becomes visible in a report.
  assert.ok(dirty.bytes > dirty.chars);
  assert.equal(dirty.hasBom, true);
  assert.equal(dirty.firstCharCodes[0], 0xfeff);
});

test("an unset or empty value says so rather than looking like a bad key", () => {
  for (const v of [undefined, ""]) {
    const r = describeKeyEnv(v);
    assert.equal(r.present, false);
    assert.equal(r.normalisedParses, false);
    assert.match(r.parseError!, /unset or empty/);
  }
});

test("the report never contains the middle of the key", () => {
  const r = describeKeyEnv(PEM);
  const body = PEM_TRIM
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const middle = body.slice(20, body.length - 20);
  const serialised = JSON.stringify(r);
  // The private scalar lives well inside the body; the 15-character windows
  // are deliberately short enough that neither reaches it.
  for (let i = 0; i + 12 <= middle.length; i += 12) {
    assert.equal(
      serialised.includes(middle.slice(i, i + 12)),
      false,
      "a 12-character run from the key body leaked into the report"
    );
  }
});

test("config resolves for every recoverable paste, not just the pristine one", () => {
  const saved = { ...process.env };
  try {
    for (const [name, value] of [
      ["literal \\n", PEM_TRIM.replace(/\n/g, "\\n")],
      ["newlines stripped", PEM_TRIM.replace(/\n/g, "")],
      ["quoted", `"${PEM_TRIM}"`],
      ["CRLF", PEM_TRIM.replace(/\n/g, "\r\n")],
    ] as Array<[string, string]>) {
      process.env = { ...saved };
      process.env.APPLE_CLIENT_ID = CFG.clientId;
      process.env.APPLE_TEAM_ID = CFG.teamId;
      process.env.APPLE_KEY_ID = CFG.keyId;
      process.env.APPLE_PRIVATE_KEY = value;
      process.env.PUBLIC_BASE_URL = "https://example.test";
      resetClientSecretCache();
      const cfg = appleConfig();
      assert.ok(cfg, `${name} should resolve`);
      // And all the way through to a signature of the right shape.
      const sig = Buffer.from(clientSecret(cfg!).split(".")[2], "base64url");
      assert.equal(sig.length, 64, `${name} should still sign as P1363`);
    }
  } finally {
    process.env = saved;
    resetClientSecretCache();
  }
});
