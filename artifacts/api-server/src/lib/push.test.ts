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
import { createServer, type Server } from "node:http";
import {
  isExpoPushToken,
  pushConfig,
  resetPushConfigCache,
  sendPush,
  subscriptionKind,
} from "./push";

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

// ------------------------------------------------------------- native arm ---

const NO_VAPID = { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined };
const PAYLOAD = { kind: "timer" as const, title: "T", body: "B", recipeId: "r", stepId: "s" };
const TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

test("the endpoint's shape is what tells the two delivery arms apart", () => {
  // Both spellings Expo has used, and nothing else.
  assert.equal(subscriptionKind("ExponentPushToken[abcDEF123_-]"), "expo");
  assert.equal(subscriptionKind("ExpoPushToken[abcDEF123_-]"), "expo");
  assert.equal(subscriptionKind("https://web.push.apple.com/QAbc"), "web");
  assert.equal(subscriptionKind("https://fcm.googleapis.com/fcm/send/x"), "web");

  // Strictness matters because the route stores what passes here, and a
  // token that Expo's service rejects would fail much later, on a timer
  // nobody is watching. Brackets, a non-empty body, no whitespace, no
  // surrounding junk.
  for (const bad of [
    "ExponentPushToken[]",
    "ExponentPushToken[abc def]",
    "ExponentPushToken[abc]extra",
    " ExponentPushToken[abc]",
    "exponentpushtoken[abc]",
    "https://exp.host/--/api/v2/push/send",
    "",
  ]) {
    assert.equal(isExpoPushToken(bad), false, JSON.stringify(bad));
  }
});

/**
 * A stand-in for Expo's push API on a loopback port. It records each request
 * body and answers with whatever the test scripted — the real service is not
 * reachable from the test environment and would need a real device token to
 * say anything useful anyway. What is under test is this side of the wire:
 * the request shape and the mapping from Expo's ticket to a SendOutcome.
 */
async function withExpoStub(
  respond: (body: any) => { status: number; json: unknown },
  fn: (seen: any[]) => Promise<void>
) {
  const seen: any[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ headers: req.headers, body });
      const out = respond(body);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/--/api/v2/push/send`;
  try {
    await withEnv({ ...NO_VAPID, EXPO_PUSH_URL: url, EXPO_ACCESS_TOKEN: undefined }, () => fn(seen));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("an Expo token is delivered with NO VAPID configuration", async () => {
  // The whole point of the second arm: a deployment that never generated
  // web push keys still buzzes the phone running the native app. The web
  // test above pins that the same call with an https endpoint says
  // "unconfigured" — the two must diverge exactly on the endpoint's shape.
  await withExpoStub(
    () => ({ status: 200, json: { data: { status: "ok", id: "ticket-1" } } }),
    async (seen) => {
      const outcome = await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, PAYLOAD);
      assert.equal(outcome, "sent");
      assert.equal(seen.length, 1);
      const { body, headers } = seen[0];
      assert.equal(body.to, TOKEN);
      assert.equal(body.title, "T");
      assert.equal(body.body, "B");
      // The tap handler needs the same recipeId/stepId the web service
      // worker gets, so the payload rides whole in `data`.
      assert.deepEqual(body.data, PAYLOAD);
      assert.equal(body.ttl, 180, "a cooking timer is worthless late, on either arm");
      assert.equal(headers.authorization, undefined, "no access token means no header");
    }
  );
});

test("DeviceNotRegistered is 'gone' — and is the ONLY ticket error that is", async () => {
  // Same contract as a web 404/410: the dispatcher deletes the row on
  // "gone" and retries on "failed", so mapping a transient code to "gone"
  // would silently unsubscribe a working phone.
  await withExpoStub(
    (body) => ({
      status: 200,
      json: {
        data: {
          status: "error",
          message: "not registered",
          details: { error: body.title === "dead" ? "DeviceNotRegistered" : "MessageRateExceeded" },
        },
      },
    }),
    async () => {
      assert.equal(
        await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, { ...PAYLOAD, title: "dead" }),
        "gone"
      );
      assert.equal(
        await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, { ...PAYLOAD, title: "busy" }),
        "failed"
      );
    }
  );
});

test("a failing Expo service is 'failed', never a throw", async () => {
  // One bad response must not take down the rest of the dispatch batch —
  // the same posture sendPush takes for the web arm.
  await withExpoStub(
    () => ({ status: 500, json: { errors: [{ code: "INTERNAL", message: "boom" }] } }),
    async () => {
      assert.equal(await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, PAYLOAD), "failed");
    }
  );
  // And an unreachable service — nothing listening — is the same answer.
  await withEnv({ ...NO_VAPID, EXPO_PUSH_URL: "http://127.0.0.1:9/--/api/v2/push/send" }, async () => {
    assert.equal(await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, PAYLOAD), "failed");
  });
});

test("EXPO_ACCESS_TOKEN, when set, rides as a bearer header", async () => {
  await withExpoStub(
    () => ({ status: 200, json: { data: { status: "ok" } } }),
    async (seen) => {
      await withEnv({ EXPO_ACCESS_TOKEN: "secret-token" }, async () => {
        await sendPush({ endpoint: TOKEN, p256dh: "", auth: "" }, PAYLOAD);
      });
      assert.equal(seen[0].headers.authorization, "Bearer secret-token");
    }
  );
});
