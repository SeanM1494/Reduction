/**
 * The extraction's model-call settings, proven on the wire: a loopback stub
 * stands in for the Messages API and records every request body, because
 * SDK 0.65 predates `output_config` in its types and the only proof the
 * field is sent is to see it arrive.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { EXTRACTION_MAX_TOKENS, effortFields, extractionEffort } from "./extractionConfig";

const TREE = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "a", qty: 1, unit: null, name: "bread" }],
      // The model's reply carries a tag whether or not it was asked for
      // one — which is what "off" must survive.
      nodes: [{ id: "n1", label: "toast", inputs: ["a"], src: 1 }],
      root: "n1",
    },
  ],
};

let server: Server;
const bodies: any[] = [];
const saved = {
  key: process.env.ANTHROPIC_API_KEY,
  base: process.env.ANTHROPIC_BASE_URL,
  effort: process.env.EXTRACTION_EFFORT,
  sources: process.env.EXTRACTION_STEP_SOURCES,
};

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: "stub",
          content: [{ type: "text", text: JSON.stringify(TREE) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 40 },
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  process.env.ANTHROPIC_API_KEY = "stub-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  for (const [k, v] of [
    ["ANTHROPIC_API_KEY", saved.key],
    ["ANTHROPIC_BASE_URL", saved.base],
    ["EXTRACTION_EFFORT", saved.effort],
    ["EXTRACTION_STEP_SOURCES", saved.sources],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("EXTRACTION_EFFORT: a level, or the model's default for anything else", () => {
  assert.equal(extractionEffort({}), null);
  assert.equal(extractionEffort({ EXTRACTION_EFFORT: "low" }), "low");
  assert.equal(extractionEffort({ EXTRACTION_EFFORT: " Medium " }), "medium");
  assert.equal(extractionEffort({ EXTRACTION_EFFORT: "lowest" }), null, "a typo is the default, never an error");
  assert.equal(extractionEffort({ EXTRACTION_EFFORT: "default" }), null);
  assert.deepEqual(effortFields(null), {});
  assert.deepEqual(effortFields("low"), { output_config: { effort: "low" } });
});

test("on the wire: 16,000 tokens always; effort only when configured", async () => {
  // Imported here so the stub's base URL is in place before the client is built.
  const { structureRecipe } = await import("./structureRecipe");

  delete process.env.EXTRACTION_EFFORT;
  bodies.length = 0;
  const plain = await structureRecipe({ text: "Toast the bread. ".repeat(5) });
  assert.equal(bodies[0].max_tokens, EXTRACTION_MAX_TOKENS);
  assert.equal("output_config" in bodies[0], false, "unset means the model's default, not a guess");
  assert.equal(plain.recipe.title, "Toast");
  assert.deepEqual(plain.usage, { inputTokens: 100, outputTokens: 40, stopReasons: ["end_turn"] });

  process.env.EXTRACTION_EFFORT = "low";
  bodies.length = 0;
  await structureRecipe({ text: "Toast the bread. ".repeat(5) });
  assert.deepEqual(bodies[0].output_config, { effort: "low" }, "the SDK passes the field through");

  // An explicit option beats the secret — the comparison script's path.
  bodies.length = 0;
  await structureRecipe({ text: "Toast the bread. ".repeat(5) }, { effort: null, maxTokens: 8000 });
  assert.equal("output_config" in bodies[0], false);
  assert.equal(bodies[0].max_tokens, 8000);
});

test("source step numbers: off asks nothing and keeps nothing; on asks and keeps", async () => {
  const { structureRecipe } = await import("./structureRecipe");
  const userText = (b: any) => b.messages[0].content.map((c: any) => c.text ?? "").join("\n");

  delete process.env.EXTRACTION_STEP_SOURCES;
  bodies.length = 0;
  const off = await structureRecipe({ text: "Toast the bread. ".repeat(5) });
  assert.equal(userText(bodies[0]).includes("NUMBER EACH STEP'S SOURCE"), false, "off: the prompt is what it was");
  assert.equal("src" in off.recipe.sections[0].nodes[0], false, "off: a tag the model sent anyway is dropped");

  process.env.EXTRACTION_STEP_SOURCES = "on";
  bodies.length = 0;
  const on = await structureRecipe({ text: "Toast the bread. ".repeat(5) });
  assert.equal(userText(bodies[0]).includes("NUMBER EACH STEP'S SOURCE"), true);
  assert.equal((on.recipe.sections[0].nodes[0] as { src?: number }).src, 1);
  delete process.env.EXTRACTION_STEP_SOURCES;
});
