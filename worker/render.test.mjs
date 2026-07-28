import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchTTS } from "./render.mjs";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creatorflow-tts-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function successfulTTSOutput(args, text) {
  const outPath = args[3];
  const wordsPath = args[4];
  const words = text.split(/\s+/).filter(Boolean).map((word, index) => ({
    w: word,
    t: index * 0.2,
    d: 0.15
  }));
  return Promise.all([
    fs.writeFile(outPath, Buffer.alloc(2048, 1)),
    fs.writeFile(wordsPath, JSON.stringify(words))
  ]);
}

test("fetchTTS retries a transient Ava failure in a fresh process", async () => {
  await withTempDir(async (dir) => {
    const outPath = path.join(dir, "scene.mp3");
    const waits = [];
    const logs = [];
    let attempts = 0;

    await fetchTTS("A short narration line for a retry test.", outPath, {
      edgeCmd: "python3",
      log: (message) => logs.push(message)
    }, {
      allowSplit: false,
      label: "test scene",
      maxAttempts: 3,
      retryBaseMs: 1,
      probeDurationFn: async () => 1.5,
      sleepFn: async (milliseconds) => waits.push(milliseconds),
      runCommand: async (_command, args) => {
        attempts++;
        if (attempts < 3) throw new Error("temporary websocket disconnect");
        const text = await fs.readFile(args[1], "utf8");
        await successfulTTSOutput(args, text);
      }
    });

    assert.equal(attempts, 3);
    assert.deepEqual(waits, [1, 2]);
    assert.equal((await fs.stat(outPath)).size, 2048);
    assert.match(logs.join("\n"), /retrying/);
  });
});

test("fetchTTS splits and rebuilds a scene after repeated full-line failure", async () => {
  await withTempDir(async (dir) => {
    const text = "one two three four five six seven eight nine ten";
    const outPath = path.join(dir, "scene.mp3");
    let calls = 0;

    await fetchTTS(text, outPath, {
      edgeCmd: "python3",
      log: () => {}
    }, {
      label: "split test",
      maxAttempts: 1,
      retryBaseMs: 0,
      probeDurationFn: async () => 1,
      sleepFn: async () => {},
      runCommand: async (_command, args) => {
        calls++;
        const partText = await fs.readFile(args[1], "utf8");
        if (partText === text) throw new Error("full line rejected");
        await successfulTTSOutput(args, partText);
      },
      concatAudioFn: async (_files, file) => {
        await fs.writeFile(file, Buffer.alloc(4096, 2));
      }
    });

    const words = JSON.parse(await fs.readFile(outPath + ".words.json", "utf8"));
    assert.equal(calls, 3);
    assert.equal((await fs.stat(outPath)).size, 4096);
    assert.equal(words.length, 10);
    assert.ok(words[5].t >= 1, "second recovery part should be offset");
  });
});
