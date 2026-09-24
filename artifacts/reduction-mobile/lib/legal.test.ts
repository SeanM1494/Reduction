import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_FALLBACK_HOST, legalUrl } from "./legal";

test("legal pages hang off the server's public host, with the public domain as the fallback", () => {
  assert.equal(legalUrl("https://recipe-reduction.replit.app", "privacy"), "https://recipe-reduction.replit.app/privacy.html");
  assert.equal(legalUrl("https://recipereduction.com/", "terms"), "https://recipereduction.com/terms.html", "a trailing slash does not double");
  assert.equal(legalUrl(null, "terms"), `${LEGAL_FALLBACK_HOST}/terms.html`);
  assert.equal(legalUrl("   ", "privacy"), `${LEGAL_FALLBACK_HOST}/privacy.html`, "blank is unset");
});
