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
