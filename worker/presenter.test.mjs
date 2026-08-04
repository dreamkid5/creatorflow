import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inferNarratorAge,
  parsePresenterAge,
  presenterAgeDescription,
  resolvePresenterAge,
  validatePresenterAge
} from "./presenter.mjs";

function claudeResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text: JSON.stringify(data) }] })
  };
}

test("explicit first-person narrator ages are parsed from digits and words", () => {
  assert.equal(parsePresenterAge("forty-one"), 41);
  assert.equal(parsePresenterAge("38"), 38);
  assert.equal(parsePresenterAge("fourteen"), null, "presenters must remain adults");
  assert.equal(inferNarratorAge("I'm a 47-year-old woman.").age, 47);
  assert.deepEqual(
    inferNarratorAge("My daughter is fourteen now. My name is Rebecca. I am forty one years old, and I live in Charlotte."),
    { age: 41, evidence: "I am forty one years old", source: "explicit script age" }
  );
  assert.equal(inferNarratorAge("My daughter is fourteen now."), null);
});

test("an explicit script age does not call Claude", async () => {
  let called = false;
  const result = await resolvePresenterAge({ script: "I'm 52 years old." }, {}, {
    fetchFn: async () => { called = true; throw new Error("should not run"); }
  });
  assert.equal(result.age, 52);
  assert.equal(called, false);
});

test("Claude infers the present-day narrator age when the script omits it", async () => {
  let prompt = "";
  const result = await resolvePresenterAge({
    title: "A marriage story",
    script: "I married at twenty five. We celebrated our twentieth anniversary last spring."
  }, {
    anthropicKey: "test-key",
    seoModel: "test-model"
  }, {
    fetchFn: async (_url, options) => {
      prompt = JSON.parse(options.body).messages[0].content;
      return claudeResponse({ age: 45, evidence: "twenty years after marrying at twenty five" });
    },
    sleepFn: async () => {}
  });
  assert.equal(result.age, 45);
  assert.match(prompt, /Do not use another character's age/);
});

test("presenter prompts describe the exact age and decade", () => {
  assert.equal(presenterAgeDescription(41), "a 41-year-old woman, visibly in her early forties");
  assert.equal(presenterAgeDescription(68), "a 68-year-old woman, visibly in her late sixties");
});

test("visible-age validation accepts a matching adult presenter", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creatorflow-presenter-age-"));
  const image = path.join(dir, "presenter.jpg");
  try {
    await fs.writeFile(image, Buffer.alloc(2048, 1));
    let requestContent = null;
    const result = await validatePresenterAge(image, 41, {
      anthropicKey: "test-key",
      seoModel: "test-model"
    }, {
      fetchFn: async (_url, options) => {
        requestContent = JSON.parse(options.body).messages[0].content;
        return claudeResponse({ estimatedAge: 42, minAge: 38, maxAge: 46, adultWoman: true });
      },
      sleepFn: async () => {}
    });
    assert.equal(result.match, true);
    assert.equal(requestContent[1].text.includes("TARGET AGE: 41"), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("visible-age validation rejects a much younger presenter", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creatorflow-presenter-age-"));
  const image = path.join(dir, "presenter.jpg");
  try {
    await fs.writeFile(image, Buffer.alloc(2048, 1));
    const result = await validatePresenterAge(image, 41, {
      anthropicKey: "test-key"
    }, {
      fetchFn: async () => claudeResponse({ estimatedAge: 24, minAge: 21, maxAge: 27, adultWoman: true }),
      sleepFn: async () => {}
    });
    assert.equal(result.match, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
