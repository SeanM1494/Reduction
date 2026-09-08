/**
 * routes/authMobile.test.ts — the mobile redirect allowlist.
 *
 * The two properties here pull in opposite directions and both matter: in
 * development the allowlist must accept what Expo Go ACTUALLY generates
 * (which is derived from the packager proxy domain, not the API domain —
 * the mismatch that shipped), and in production it must accept nothing a
 * client names, ever. A regression in the first is a broken dev loop; a
 * regression in the second hands an attacker's app the sign-in handoff.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedMobileRedirect, resolveMobileRedirect } from "./auth";

const DEV_DOMAIN = "abc-00-xyz.janeway.replit.dev";
const EXPO_DOMAIN = "abc-8081.janeway.replit.dev";
const FIXED = "reduction-mobile://auth";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

const dev = { NODE_ENV: "development", REPLIT_DEV_DOMAIN: DEV_DOMAIN, REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN };

test("the app's own fixed scheme is accepted in every environment", () => {
  for (const nodeEnv of ["development", "production", undefined]) {
    withEnv({ ...dev, NODE_ENV: nodeEnv }, () => {
      assert.equal(isAllowedMobileRedirect(FIXED), true, String(nodeEnv));
    });
  }
});

test("dev accepts what Expo Go actually generates: the PACKAGER domain", () => {
  withEnv(dev, () => {
    // Linking.createURL derives from EXPO_PACKAGER_PROXY_URL, so this — not
    // the API domain — is the redirect that arrives. Rejecting it was the
    // bug: the silent fallback sent Safari to a scheme Expo Go cannot open.
    assert.equal(isAllowedMobileRedirect(`exp://${EXPO_DOMAIN}/--/auth`), true);
    assert.equal(isAllowedMobileRedirect(`exps://${EXPO_DOMAIN}/--/auth`), true);
    assert.equal(isAllowedMobileRedirect(`exp://sub.${EXPO_DOMAIN}/--/auth`), true);
  });
});

test("dev still accepts the API dev domain too", () => {
  withEnv(dev, () => {
    assert.equal(isAllowedMobileRedirect(`exp://${DEV_DOMAIN}/--/auth`), true);
    assert.equal(isAllowedMobileRedirect(`exp://sub.${DEV_DOMAIN}/--/auth`), true);
  });
});

test("dev rejects hosts on neither domain, and suffix means SUBDOMAIN", () => {
  withEnv(dev, () => {
    assert.equal(isAllowedMobileRedirect("exp://evil.example.com/--/auth"), false);
    // A registrable-domain cousin is not a subdomain: janeway.replit.dev
    // hosts other people's repls, and "ends with the string" without the dot
    // boundary would admit evilabc-8081.janeway.replit.dev.
    assert.equal(isAllowedMobileRedirect(`exp://evil${EXPO_DOMAIN}/--/auth`), false);
    assert.equal(isAllowedMobileRedirect("exp://janeway.replit.dev/--/auth"), false);
  });
});

test("dev rejects non-exp schemes outright", () => {
  withEnv(dev, () => {
    for (const url of [
      `https://${EXPO_DOMAIN}/--/auth`,
      `reduction-mobile://elsewhere`,
      `javascript:alert(1)`,
      `exp:not-a-url-really`,
      ``,
    ]) {
      assert.equal(isAllowedMobileRedirect(url), false, url);
    }
  });
});

test("PRODUCTION accepts nothing a client names — Expo Go against prod refuses by design", () => {
  withEnv({ ...dev, NODE_ENV: "production" }, () => {
    // Even a redirect that dev would accept, with both env domains present.
    assert.equal(isAllowedMobileRedirect(`exp://${EXPO_DOMAIN}/--/auth`), false);
    assert.equal(isAllowedMobileRedirect(`exp://${DEV_DOMAIN}/--/auth`), false);
    // The one thing production honors is the app's own scheme.
    assert.equal(isAllowedMobileRedirect(FIXED), true);
  });
});

test("resolveMobileRedirect degrades to the fixed scheme, never fails", () => {
  withEnv(dev, () => {
    assert.equal(resolveMobileRedirect(`exp://${EXPO_DOMAIN}/--/auth`), `exp://${EXPO_DOMAIN}/--/auth`);
    for (const bad of [undefined, null, 42, "exp://evil.example.com/x", "x".repeat(2001)]) {
      assert.equal(resolveMobileRedirect(bad), FIXED, String(bad).slice(0, 40));
    }
  });
});

test("an unset REPLIT_EXPO_DEV_DOMAIN just narrows the allowlist", () => {
  withEnv({ ...dev, REPLIT_EXPO_DEV_DOMAIN: undefined }, () => {
    assert.equal(isAllowedMobileRedirect(`exp://${DEV_DOMAIN}/--/auth`), true);
    assert.equal(isAllowedMobileRedirect(`exp://${EXPO_DOMAIN}/--/auth`), false);
  });
});
