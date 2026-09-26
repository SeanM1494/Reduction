/**
 * The Anthropic-fetch fallback on the wire, against a loopback stub of the
 * Messages API that answers from a script: a paused fetch is RESUMED with
 * the page it already fetched, a reply with no recipe in it ends the reading
 * at once with the message a person can act on, and the fallback runs at its
 * own effort when one is set. Anthropic's servers are unreachable from the
 * agent container, so what the stub cannot prove is the real server's side
 * of a resume — only that we send what the API documents it needs.
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { extractionFallbackEffort, fallbackCall } from "./extractionConfig";

const URL_ = "https://recipes.example/toast";
const TREE = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "a", qty: 1, unit: null, name: "bread" }],
      nodes: [{ id: "n1", label: "toast", inputs: ["a"] }],
      root: "n1",
    },
  ],
};

const text = (t: string) => [{ type: "text", text: t }];
const FETCHED = [
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_fetch", input: { url: URL_ } },
  {
    type: "web_fetch_tool_result",
    tool_use_id: "srvtoolu_1",
    content: {
      type: "web_fetch_result",
      url: URL_,
      content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Toast the bread." } },
    },
  },
];

let server: Server;
const bodies: any[] = [];
let script: { stop: string; content: unknown[] }[] = [];
const saved = {
  key: process.env.ANTHROPIC_API_KEY,
  base: process.env.ANTHROPIC_BASE_URL,
  effort: process.env.EXTRACTION_EFFORT,
  fallback: process.env.EXTRACTION_FALLBACK_EFFORT,
};

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      const next = script.shift() ?? { stop: "end_turn", content: text("{}") };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${bodies.length}`,
          type: "message",
          role: "assistant",
          model: "stub",
          content: next.content,
          stop_reason: next.stop,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  process.env.ANTHROPIC_API_KEY = "stub-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

beforeEach(() => {
  bodies.length = 0;
  script = [];
  delete process.env.EXTRACTION_EFFORT;
  delete process.env.EXTRACTION_FALLBACK_EFFORT;
});

after(() => {
  server.close();
  for (const [k, v] of [
    ["ANTHROPIC_API_KEY", saved.key],
    ["ANTHROPIC_BASE_URL", saved.base],
    ["EXTRACTION_EFFORT", saved.effort],
    ["EXTRACTION_FALLBACK_EFFORT", saved.fallback],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("a paused fetch is resumed with what it fetched: no new user turn, not an attempt", async () => {
  const { structureRecipeFromUrl } = await import("./fetchViaClaude");
  script = [
    { stop: "pause_turn", content: FETCHED },
    { stop: "end_turn", content: text(JSON.stringify(TREE)) },
  ];
  const out = await structureRecipeFromUrl(URL_);
  assert.equal(bodies.length, 2);
  const second = bodies[1].messages;
  assert.equal(second.length, 2, "the user turn and the paused assistant turn — nothing asking it to 'continue'");
  assert.equal(second[1].role, "assistant");
  assert.deepEqual(second[1].content, FETCHED, "the fetched page goes back exactly as it came");
  assert.equal(out.attempts, 1, "a resume is not a second attempt");
  assert.deepEqual(out.usage.stopReasons, ["pause_turn", "end_turn"]);
  assert.deepEqual(out.usage.failures, []);
});

test("a reply with no recipe in it ends the reading at once, with the blocked message", async () => {
  const { structureRecipeFromUrl, BLOCKED_MESSAGE, isUnreadable } = await import("./fetchViaClaude");
  for (const reply of ['{"unreadable": "an access-denied page"}', "I was unable to access that page.", '{"error": "blocked"}']) {
    bodies.length = 0;
    script = [{ stop: "end_turn", content: [...FETCHED, ...text(reply)] }];
    await assert.rejects(structureRecipeFromUrl(URL_), (e: any) => {
      assert.equal(e.message, BLOCKED_MESSAGE, reply);
      assert.equal(isUnreadable(e), true);
      assert.equal(e.usage.failures.length, 1);
      assert.match(e.usage.failures[0][0], /^No recipe in the reply/);
      return true;
    });
    assert.equal(bodies.length, 1, `no repair call for: ${reply}`);
  }
  assert.match(BLOCKED_MESSAGE, /blocked/, "the routes' user-facing test matches it");
});

test("the fetch tool's own refusal is the blocked message too", async () => {
  const { structureRecipeFromUrl, BLOCKED_MESSAGE } = await import("./fetchViaClaude");
  script = [
    {
      stop: "end_turn",
      content: [
        FETCHED[0],
        { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_fetch_tool_error", error_code: "url_not_accessible" } },
        ...text("I could not fetch it."),
      ],
    },
  ];
  await assert.rejects(structureRecipeFromUrl(URL_), { message: BLOCKED_MESSAGE });
});

test("a recipe that fails a rule is still repaired, and the rule is kept", async () => {
  const { structureRecipeFromUrl } = await import("./fetchViaClaude");
  const noLabel = structuredClone(TREE);
  (noLabel.sections[0].nodes[0] as { label?: string }).label = "";
  script = [
    { stop: "end_turn", content: text(JSON.stringify(noLabel)) },
    { stop: "end_turn", content: text(JSON.stringify(TREE)) },
  ];
  const out = await structureRecipeFromUrl(URL_);
  assert.equal(out.attempts, 2);
  assert.deepEqual(out.usage.failures, [['section "Toast": step "n1" is missing a label.']]);
  assert.match(bodies[1].messages.at(-1).content, /failed validation/);
});

test("EXTRACTION_FALLBACK_EFFORT: unset follows, 'default' is the model's own, a typo follows", () => {
  assert.equal(extractionFallbackEffort({}), undefined);
  assert.equal(extractionFallbackEffort({ EXTRACTION_FALLBACK_EFFORT: "default" }), null);
  assert.equal(extractionFallbackEffort({ EXTRACTION_FALLBACK_EFFORT: " High " }), "high");
  assert.equal(extractionFallbackEffort({ EXTRACTION_FALLBACK_EFFORT: "hgih" }), undefined);
  assert.deepEqual(fallbackCall({ effort: "low" }), { effort: "low" }, "unset: the fallback is not special");
  assert.deepEqual(fallbackCall({ effort: "low", fallbackEffort: null }).effort, null);
});

test("readRecipeAtUrl: our fetch refused → the fallback runs at its own effort; no recipe → blocked", async () => {
  const { readRecipeAtUrl } = await import("./readRecipe");
  const { BLOCKED_MESSAGE } = await import("./fetchViaClaude");
  // A loopback URL: our own fetch refuses private addresses, which is the
  // refused-fetch path without touching the network.
  const url = "http://127.0.0.1:9/recipe";

  script = [{ stop: "end_turn", content: text(JSON.stringify(TREE)) }];
  const out = await readRecipeAtUrl(url, { effort: "low", fallbackEffort: null });
  assert.equal(out.via, "claude");
  assert.equal(out.fallback?.reason, "fetch");
  assert.equal("output_config" in bodies[0], false, "fallbackEffort null: the model's own effort");

  bodies.length = 0;
  process.env.EXTRACTION_EFFORT = "low";
  script = [{ stop: "end_turn", content: text(JSON.stringify(TREE)) }];
  await readRecipeAtUrl(url);
  assert.deepEqual(bodies[0].output_config, { effort: "low" }, "unset: the fallback follows EXTRACTION_EFFORT");

  bodies.length = 0;
  process.env.EXTRACTION_FALLBACK_EFFORT = "default";
  script = [{ stop: "end_turn", content: text(JSON.stringify(TREE)) }];
  await readRecipeAtUrl(url);
  assert.equal("output_config" in bodies[0], false, "the secret reaches the fallback alone");

  script = [{ stop: "end_turn", content: text('{"unreadable": "bot check"}') }];
  await assert.rejects(readRecipeAtUrl(url), (e: any) => {
    assert.equal(e.message, BLOCKED_MESSAGE);
    assert.deepEqual(e.usage.failures, [["No recipe in the reply: bot check"]]);
    return true;
  });
});
