import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThemeMode, resolveTheme, THEME_MODES } from "./themePolicy";

test("parseThemeMode: the three stored choices, everything else is system", () => {
  assert.equal(parseThemeMode("light"), "light");
  assert.equal(parseThemeMode("dark"), "dark");
  assert.equal(parseThemeMode("colorblind"), "colorblind");
  assert.equal(parseThemeMode("system"), "system");
  assert.equal(parseThemeMode(null), "system");
  assert.equal(parseThemeMode(undefined), "system");
  assert.equal(parseThemeMode("sepia"), "system");
  assert.equal(parseThemeMode(42), "system");
});

test("resolveTheme: light and dark fix the base; system and colorblind follow the phone", () => {
  assert.deepEqual(resolveTheme("light", "dark"), { base: "light", colorblind: false });
  assert.deepEqual(resolveTheme("dark", "light"), { base: "dark", colorblind: false });
  assert.deepEqual(resolveTheme("system", "dark"), { base: "dark", colorblind: false });
  assert.deepEqual(resolveTheme("system", "light"), { base: "light", colorblind: false });
  // No system answer at all (a web preview with no media query): light.
  assert.deepEqual(resolveTheme("system", null), { base: "light", colorblind: false });
  // Colorblind layers on the system base — the web's rule.
  assert.deepEqual(resolveTheme("colorblind", "dark"), { base: "dark", colorblind: true });
  assert.deepEqual(resolveTheme("colorblind", "light"), { base: "light", colorblind: true });
});

test("the four modes are offered in the web's order, with System first", () => {
  assert.deepEqual(THEME_MODES.map((m) => m.mode), ["system", "light", "dark", "colorblind"]);
});
