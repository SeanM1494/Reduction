import test from "node:test";
import assert from "node:assert/strict";
import {
  CRASH_LIMITS,
  componentFrames,
  crashFingerprintSource,
  crashReportFrom,
  framesOf,
  sanitizeCrashReport,
  scrubFrame,
  scrubRoute,
  scrubText,
} from "./crashReport";

const IOS_STACK = `TypeError: undefined is not an object (evaluating 'recipe.sections[0]')
    at RecipeScreen (address at /var/containers/Bundle/Application/3F2A1B4C-1D2E-4F50-8A9B-0C1D2E3F4A5B/Reduction.app/main.jsbundle:1:482113)
    at renderWithHooks (/private/var/mobile/Containers/Data/Application/11111111-2222-4333-8444-555555555555/Library/Application Support/.expo-internal/abc/bundle-9f8e.hbc:1:99)
    at anonymous (native)`;

test("crash: quoted text is taken out, except the code after 'evaluating'", () => {
  assert.equal(
    scrubText(`undefined is not an object (evaluating 'recipe.sections[0]')`),
    `undefined is not an object (evaluating 'recipe.sections[0]')`
  );
  assert.equal(scrubText(`JSON Parse error: Unexpected identifier "Grandma's lasagne"`).includes("lasagne"), false);
  assert.equal(scrubText(`Could not save “Chicken tikka”`), `Could not save “…”`);
});

test("crash: URLs, emails, uuids and long numbers never survive the scrub", () => {
  const s = scrubText(
    "fetch https://example.com/recipes/42?token=abc for sean@example.com id 3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b order 1234567 hash deadbeefdeadbeefdead"
  );
  for (const bad of ["example.com", "sean@", "3f2a1b4c", "1234567", "deadbeef"]) assert.equal(s.includes(bad), false, `${bad} in ${s}`);
  assert.match(s, /<url>.*<email>.*<id>.*<n>.*<id>/);
});

test("crash: a message is clamped", () => {
  assert.equal(scrubText("x ".repeat(1000)).length, CRASH_LIMITS.message);
});

test("crash: frames keep the function and file:line:col, and lose every path (the container UUID is per install)", () => {
  const frames = framesOf(IOS_STACK);
  assert.deepEqual(frames, [
    "RecipeScreen (main.jsbundle:1:482113)",
    "renderWithHooks (bundle-9f8e.hbc:1:99)",
    "anonymous (native)",
  ]);
  assert.equal(scrubFrame("at f (https://recipereduction.com/assets/index-Ab12.js?v=3:2:40)"), "f (index-Ab12.js:2:40)");
  // Safari's shape
  assert.equal(scrubFrame("render@https://recipereduction.com/assets/index-Ab12.js:2:40"), "render@index-Ab12.js:2:40");
  assert.equal(framesOf("x\n" + "    at f (a.js:1:1)\n".repeat(40)).length, CRASH_LIMITS.frames);
});

test("crash: a component stack gives component names only", () => {
  assert.deepEqual(componentFrames("\n    in RecipeScreen (at [id].tsx:12)\n    in View\n    at Gate (http://x/y.js:1:2)"), [
    "<RecipeScreen>",
    "<View>",
    "<Gate>",
  ]);
});

test("crash: a route keeps its pattern and loses ids", () => {
  assert.equal(scrubRoute("/recipe/[id]"), "/recipe/[id]");
  assert.equal(scrubRoute("/recipe/3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b"), "/recipe/<id>");
  assert.equal(scrubRoute(""), null);
});

test("crash: crashReportFrom builds a sanitized report from anything thrown, and never throws", () => {
  const e = new TypeError("undefined is not an object (evaluating 'x.y')");
  e.stack = IOS_STACK;
  const r = crashReportFrom("render", e, { platform: "ios", route: "/recipe/[id]", appVersion: "1.1.0", updateId: "3F2A1B4C-1D2E-4F50-8A9B-0C1D2E3F4A5B" }, "\n in RecipeScreen");
  assert.equal(r.name, "TypeError");
  assert.equal(r.stack.at(-1), "<RecipeScreen>");
  assert.equal(r.updateId, "3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b");
  for (const odd of [null, undefined, 42, "a string", { message: { nested: true } }]) {
    const x = crashReportFrom("fatal", odd, { platform: "web" });
    assert.equal(x.kind, "fatal");
    assert.equal(typeof x.message, "string");
  }
});

test("crash: the server gate refuses what is not a report and re-scrubs what is", () => {
  assert.equal(sanitizeCrashReport(null), null);
  assert.equal(sanitizeCrashReport({ kind: "boom", platform: "ios" }), null);
  assert.equal(sanitizeCrashReport({ kind: "fatal", platform: "windows" }), null);
  const r = sanitizeCrashReport({
    kind: "fatal",
    platform: "ios",
    name: "Error<script>",
    message: "user sean@example.com",
    stack: ["at f (/var/containers/Bundle/Application/3F2A1B4C-1D2E-4F50-8A9B-0C1D2E3F4A5B/R.app/main.jsbundle:1:2)", 7],
    appVersion: "1.1.0; drop table",
    channel: "production",
    updateId: "not-a-uuid",
    userId: "should vanish",
  })!;
  assert.equal(r.name, "Errorscript");
  assert.equal(r.message, "user <email>");
  assert.deepEqual(r.stack, ["f (main.jsbundle:1:2)"]);
  assert.equal(r.appVersion, null);
  assert.equal(r.channel, "production");
  assert.equal(r.updateId, null);
  assert.equal("userId" in r, false);
});

test("crash: the fingerprint groups by kind, class and top frames, not by message", () => {
  const a = sanitizeCrashReport({ kind: "fatal", platform: "ios", name: "TypeError", message: "a", stack: ["f (x.js:1:2)"] })!;
  const b = { ...a, message: "b" };
  assert.equal(crashFingerprintSource(a), crashFingerprintSource(b));
  const noFrames = { ...a, stack: [], message: "row 12 failed" };
  assert.equal(crashFingerprintSource(noFrames), crashFingerprintSource({ ...noFrames, message: "row 13 failed" }));
});

test("crash: a message line is never taken for a frame, even holding an email (Chromium, Oct 1)", () => {
  const stack = `TypeError: Could not read "pie" at https://x.example/r/1 for a@b.com
    at eval (eval at evaluate (:290:30), <anonymous>:1:38)`;
  const frames = framesOf(stack);
  assert.equal(frames.length, 1);
  assert.equal(JSON.stringify(frames).includes("a@b.com"), false);
});

test("crash: a forged frame cannot carry an email or an id past the server", () => {
  const r = sanitizeCrashReport({ kind: "error", platform: "web", stack: ["sean@example.com wrote 3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b"] })!;
  assert.equal(r.stack[0]!.includes("sean@"), false);
  assert.equal(r.stack[0]!.includes("3f2a1b4c"), false);
});
