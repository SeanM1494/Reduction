import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePushState, isExpoPushToken, notificationTarget, type PushFacts } from "./pushPolicy";

const device: PushFacts = { platform: "ios", isDevice: true, projectId: "proj", permission: "undetermined", storedToken: null };

test("derivePushState: the web build and a simulator can never hold a token", () => {
  assert.equal(derivePushState({ ...device, platform: "web" }), "unsupported");
  assert.equal(derivePushState({ ...device, isDevice: false }), "unsupported");
});

test("derivePushState: a build without an EAS project id is a setup problem, not a toggle", () => {
  assert.equal(derivePushState({ ...device, projectId: null }), "needs-setup");
  assert.equal(derivePushState({ ...device, projectId: "" }), "needs-setup");
});

test("derivePushState: denied beats a stale token, and a stored token means on", () => {
  assert.equal(derivePushState({ ...device, permission: "denied", storedToken: "ExponentPushToken[x]" }), "denied");
  assert.equal(derivePushState({ ...device, permission: "granted", storedToken: "ExponentPushToken[x]" }), "on");
  assert.equal(derivePushState({ ...device, permission: "granted" }), "off");
  assert.equal(derivePushState({ ...device, permission: "undetermined" }), "off");
  assert.equal(derivePushState({ ...device, permission: null }), "off");
});

test("isExpoPushToken matches the server's shape check", () => {
  assert.equal(isExpoPushToken("ExponentPushToken[abc-DEF_123]"), true);
  assert.equal(isExpoPushToken("ExpoPushToken[abc]"), true);
  assert.equal(isExpoPushToken("https://fcm.googleapis.com/x"), false);
  assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
  assert.equal(isExpoPushToken("ExponentPushToken[a b]"), false);
});

test("notificationTarget reads the server's TimerPayload and nothing else", () => {
  assert.deepEqual(notificationTarget({ kind: "timer", title: "t", body: "b", recipeId: "r1", stepId: "s1" }), { recipeId: "r1", stepId: "s1" });
  assert.equal(notificationTarget({ kind: "other", recipeId: "r1", stepId: "s1" }), null);
  assert.equal(notificationTarget({ kind: "timer", stepId: "s1" }), null);
  assert.equal(notificationTarget({ kind: "timer", recipeId: "", stepId: "s1" }), null);
  assert.equal(notificationTarget(null), null);
  assert.equal(notificationTarget("timer"), null);
});
