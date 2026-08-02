import test from "node:test";
import assert from "node:assert/strict";
import {
  generateThumbnailHook,
  thumbnailHook,
  thumbnailHookPrompt,
  validateThumbnailHook
} from "./thumbnail.mjs";

test("automatic thumbnail copy is a punchy two-beat kicker", async () => {
  let requestedPrompt = "";
  const hook = await generateThumbnailHook({
    title: "My Mother in Law Moved Into Our Spare Room",
    script: "I found hidden wills and a notary stamp. She planned to take my daughter's college fund."
  }, {
    anthropicKey: "test-key",
    seoModel: "test-model"
  }, {
    fetchFn: async (_url, options) => {
      requestedPrompt = JSON.parse(options.body).messages[0].content;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ text: '{"line1":"SHE TOOK OVER OUR HOME","line2":"THEN TARGETED MY DAUGHTER"}' }]
        })
      };
    },
    sleepFn: async () => {}
  });

  assert.equal(hook, "SHE TOOK OVER OUR HOME\nTHEN TARGETED MY DAUGHTER");
  assert.match(requestedPrompt, /exactly two complementary headline lines/i);
  assert.match(requestedPrompt, /college fund/i);
});

test("the locked validator rejects flat or overlong thumbnail sentences", () => {
  assert.equal(validateThumbnailHook("I FOUND THE PEN FIRST"), null);
  assert.equal(validateThumbnailHook("THIS FIRST LINE HAS FAR TOO MANY WORDS\nTHEN CAME THE TWIST"), null);
  assert.equal(validateThumbnailHook("YOU WON'T BELIEVE\nWHAT HAPPENED NEXT"), null);
  assert.equal(validateThumbnailHook("SHE FORGED OUR WILLS\nWHILE WE SLEPT"), "SHE FORGED OUR WILLS\nWHILE WE SLEPT");
});

test("manual hooks must also use two balanced beats", async () => {
  const hook = await generateThumbnailHook({
    hook: "MY WIFE FAKED HER DEATH | TO START A NEW FAMILY"
  }, {});
  assert.equal(hook, "MY WIFE FAKED HER DEATH\nTO START A NEW FAMILY");
  await assert.rejects(
    generateThumbnailHook({ hook: "I found the pen first" }, {}),
    /must form two punchy lines/
  );
});

test("automatic thumbnail copy fails closed without Claude", async () => {
  await assert.rejects(
    generateThumbnailHook({ title: "A Story", script: "A script." }, {}),
    /ANTHROPIC_API_KEY is required/
  );
});

test("automatic thumbnail copy retries invalid model output and then stops", async () => {
  let attempts = 0;
  await assert.rejects(
    generateThumbnailHook({ title: "A Real Story", script: "A long enough script." }, {
      anthropicKey: "test-key"
    }, {
      fetchFn: async () => {
        attempts++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [{ text: '{"line1":"ONE FLAT LINE","line2":""}' }] })
        };
      },
      sleepFn: async () => {}
    }),
    /could not generate a valid two-line thumbnail kicker/
  );
  assert.equal(attempts, 3);
});

test("legacy helper no longer copies the opening sentence", () => {
  const hook = thumbnailHook({
    title: "My Wife Faked Her Death To Escape Our Marriage And Start A New Family",
    script: "I paid four hundred dollars for a headstone with my wife's name on it."
  });
  assert.equal(hook.split("\n").length, 2);
  assert.doesNotMatch(hook, /FOUR HUNDRED DOLLARS/);
});

test("the model prompt excludes flat opening-sentence copy", () => {
  const prompt = thumbnailHookPrompt({ title: "Test", script: "I found a hidden letter." });
  assert.match(prompt, /Do not copy a full opening sentence/);
  assert.match(prompt, /setup and payoff/);
});
