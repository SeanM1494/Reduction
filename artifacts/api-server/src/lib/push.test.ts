/**
 * server/lib/push.test.ts — the parts that need no database and no network.
 *
 * Separate from push.db.test.ts so these run on a machine with no Postgres:
 * they are about configuration and failure posture, which is exactly what is
 * easiest to get wrong and never notice, because the symptom is a
 * notification that silently does not arrive.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { pushConfig, resetPushConfigCache, sendPush } from "./push";

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  resetPushConfigCache();
  const restore = () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetPushConfigCache();
  };
  const out = fn();
  if (out instanceof Promise) return out.finally(restore);
  restore();
  return undefined;
}

// A real generated pair — the library validates the curve, so placeholders
// would fail for the wrong reason.
const PUB = "BEeYZ7VfGYNMPhaAP-8lD9nUCUAzMhLnBjBSNCMbXTb0mMHDMEmSxYtNKPDAjLYzs1hqUEDe0aWzBcqLbaCwCPo";
const PRIV = "cGDXhZKGZ1QO8ZC6dP9DGMr7vDzXvXzBiCZ8ZmvcM5A";

test("push is unconfigured, not broken, when the keys are absent", () => {
  withEnv(
    { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined },
    () => {
      // The client hides the toggle on a null public key rather than
      // rendering a control that cannot work — the posture googleConfig()
      // takes for the sign-in button.
      assert.equal(pushConfig(), null);
    }
  );
});

test("a partial configuration counts as unconfigured", () => {
  // Half-set keys are the state a half-finished Secrets edit leaves behind.
  // Treating that as configured means every send throws at runtime instead.
  withEnv({ VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: "mailto:a@b.c" }, () => {
    assert.equal(pushConfig(), null);
  });
  withEnv({ VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: PRIV, VAPID_SUBJECT: undefined }, () => {
    // Apple rejects a missing or non-URL subject, so an unset one must not
    // be defaulted to something that will 400 at send time.
    assert.equal(pushConfig(), null);
  });
});

test("a full configuration reports the public key the client needs", () => {
  withEnv({ VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: PRIV, VAPID_SUBJECT: "mailto:a@b.c" }, () => {
    assert.equal(pushConfig()?.publicKey, PUB);
  });
});

test("sending without configuration reports it rather than throwing", async () => {
  // The dispatcher checks pushConfig() first, but a send that threw here
  // would take down a whole batch of unrelated timers.
  await withEnv(
    { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined },
    async () => {
      const outcome = await sendPush(
        { endpoint: "https://push.invalid/x", p256dh: "a", auth: "b" },
        { kind: "timer", title: "T", body: "B", recipeId: "r", stepId: "s" }
      );
      assert.equal(outcome, "unconfigured");
    }
  );
});
