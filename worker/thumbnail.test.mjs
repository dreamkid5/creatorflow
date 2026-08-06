import test from "node:test";
import assert from "node:assert/strict";
import {
  generateThumbnailHook,
  thumbnailHookPrompt,
  validateThumbnailHook,
  scriptFallbackHook,
  SEGMENT_ORDER
} from "./thumbnail.mjs";

function claudeResponse(segments) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text: JSON.stringify(segments) }] })
  };
}

const goodHook = {
  setup: "My mother-in-law changed the locks while we were on vacation and told everyone the house was finally hers",
  pivot: "She forgot one thing",
  leverage: "My name was the only one on the deed",
  payoff: "and the next morning I had the police at her door"
};

test("automatic thumbnail copy is a wordy four-beat kicker", async () => {
  let requestedPrompt = "";
  const hook = await generateThumbnailHook({
    title: "My Mother in Law Changed the Locks",
    script: "While we were on vacation she changed the locks. My name was the only one on the deed."
  }, {
    anthropicKey: "test-key",
    seoModel: "test-model"
  }, {
    fetchFn: async (_url, options) => {
      requestedPrompt = JSON.parse(options.body).messages[0].content;
      return claudeResponse(goodHook);
    },
    sleepFn: async () => {}
  });

  assert.deepEqual(SEGMENT_ORDER, ["setup", "pivot", "leverage", "payoff"]);
  assert.equal(hook.setup, goodHook.setup);
  assert.equal(hook.payoff, goodHook.payoff);
  assert.match(requestedPrompt, /four ordered beats/i);
  assert.match(requestedPrompt, /deed/i);
});

test("the validator keeps sentence case and rejects bad shapes", () => {
  const ok = validateThumbnailHook(goodHook);
  assert.equal(ok.setup, goodHook.setup);
  // rejects a missing beat
  assert.equal(validateThumbnailHook({ setup: goodHook.setup, pivot: "She forgot one thing" }), null);
  // rejects an over-long pivot (more than 7 words)
  assert.equal(validateThumbnailHook({ ...goodHook, pivot: "She forgot the one single important little thing here" }), null);
  // rejects generic teaser copy
  assert.equal(validateThumbnailHook({
    setup: "You won't believe what my mother in law actually did to us that week",
    pivot: "It was wild",
    leverage: "I had the receipts",
    payoff: "and I made her pay for it"
  }), null);
  // accepts the pipe-joined form too
  assert.ok(validateThumbnailHook(
    [goodHook.setup, goodHook.pivot, goodHook.leverage, goodHook.payoff].join(" | ")
  ));
});

test("manual hooks must be four balanced beats", async () => {
  const hook = await generateThumbnailHook({
    hook: [goodHook.setup, goodHook.pivot, goodHook.leverage, goodHook.payoff].join(" | ")
  }, {});
  assert.equal(hook.leverage, goodHook.leverage);
  await assert.rejects(
    generateThumbnailHook({ hook: "just one flat line" }, {}),
    /four beats/
  );
});

test("automatic copy falls back to the script instead of failing the video", async () => {
  const hook = await generateThumbnailHook({
    title: "A Real Story",
    script: "My sister emptied our late mother's account and laughed about it. The bank had every transfer on record. The judge froze her assets by Friday."
  }, {
    anthropicKey: "test-key"
  }, {
    // model keeps returning junk; the script fallback must save the render
    fetchFn: async () => claudeResponse({ setup: "", pivot: "", leverage: "", payoff: "" }),
    sleepFn: async () => {}
  });
  assert.equal(Object.keys(hook).length, 4);
  for (const key of SEGMENT_ORDER) assert.ok(hook[key].length > 0);
});

test("script fallback builds a four-beat hook with no API key", () => {
  const hook = scriptFallbackHook({
    script: "My landlord tried to evict us with a forged notice while I was in hospital. The signature on it was not mine. My lawyer filed the very next morning."
  });
  assert.ok(hook);
  assert.equal(Object.keys(hook).length, 4);
});

test("prompt asks for the exact four-beat JSON shape", () => {
  const prompt = thumbnailHookPrompt({ title: "T", script: "S" });
  assert.match(prompt, /"setup".*"pivot".*"leverage".*"payoff"/);
});
