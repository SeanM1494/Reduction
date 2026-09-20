import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_ERRORS, describeAuthError, GENERIC_AUTH_ERROR, offerFrom } from "./authErrors";

// Every code server/routes/auth.ts can put on the deep link. Grep for
// `auth_error:` there; a new one has to land here with a sentence.
const SERVER_CODES = ["declined", "expired", "bad_callback", "exchange_failed", "start_failed", "not_configured"];

test("every server code has its own sentence, the web's", () => {
  for (const code of SERVER_CODES) {
    assert.equal(typeof AUTH_ERRORS[code], "string", `no sentence for ${code}`);
    assert.notEqual(describeAuthError(code), GENERIC_AUTH_ERROR, `${code} fell through to the generic line`);
  }
  assert.equal(describeAuthError("declined"), "That sign-in was cancelled before it finished.");
  assert.equal(describeAuthError("expired"), "That sign-in took too long and expired. Starting again should work.");
  assert.equal(describeAuthError("not_configured"), "Sign-in isn't available on this server right now.");
});

test("an unknown, missing or non-string code gets the generic sentence", () => {
  assert.equal(describeAuthError("something_new"), GENERIC_AUTH_ERROR);
  assert.equal(describeAuthError(undefined), GENERIC_AUTH_ERROR);
  assert.equal(describeAuthError(["declined", "expired"]), GENERIC_AUTH_ERROR);
});

test("offerFrom: unknown offers both enabled; known follows the web's rule", () => {
  assert.deepEqual(offerFrom(null), { google: true, apple: "enabled", noneConfigured: false });
  assert.deepEqual(offerFrom({ google: true, apple: true }), { google: true, apple: "enabled", noneConfigured: false });
  assert.deepEqual(offerFrom({ google: true, apple: false }), { google: true, apple: "coming-soon", noneConfigured: false });
  assert.deepEqual(offerFrom({ google: false, apple: true }), { google: false, apple: "enabled", noneConfigured: false });
  assert.deepEqual(offerFrom({ google: false, apple: false }), { google: false, apple: "coming-soon", noneConfigured: true });
});
