import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  LOCKED_SCENE_SECONDS,
  atempoFiltersForDuration,
  fetchTTS,
  lockNarrationDuration,
  scaleWordTimings
} from "./render.mjs";

const execFileAsync = promisify(execFile);
const bundledFfmpeg = fileURLToPath(new URL("./tools/ffmpeg", import.meta.url));
const bundledFfprobe = fileURLToPath(new URL("./tools/ffprobe", import.meta.url));

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

test("production scene duration is permanently locked to 5.5 seconds", () => {
  assert.equal(LOCKED_SCENE_SECONDS, 5.5);
  assert.deepEqual(atempoFiltersForDuration(11, LOCKED_SCENE_SECONDS), [
    "atempo=2.00000000"
  ]);
  assert.deepEqual(atempoFiltersForDuration(1.375, LOCKED_SCENE_SECONDS), [
    "atempo=0.5",
    "atempo=0.50000000"
  ]);
});

test("caption word timings scale to the locked scene duration", () => {
  const scaled = scaleWordTimings([
    { w: "hello", t: 1, d: 0.5 },
    { w: "world", t: 4, d: 1 }
  ], 5, LOCKED_SCENE_SECONDS);
  assert.deepEqual(scaled, [
    { w: "hello", t: 1.1, d: 0.55 },
    { w: "world", t: 4.4, d: 1.1 }
  ]);
});

test("real narration audio is rendered to exactly 5.5 seconds", async () => {
  await withTempDir(async (dir) => {
    const audioPath = path.join(dir, "scene.wav");
    const wordsPath = audioPath + ".words.json";
    await execFileAsync(bundledFfmpeg, [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", audioPath
    ]);
    await fs.writeFile(wordsPath, JSON.stringify([
      { w: "locked", t: 1, d: 0.5 }
    ]));

    await lockNarrationDuration(audioPath, wordsPath, 2, {
      ffmpeg: bundledFfmpeg,
      ffprobe: bundledFfprobe
    });

    const { stdout } = await execFileAsync(bundledFfprobe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", audioPath
    ]);
    assert.ok(Math.abs(Number(stdout.trim()) - LOCKED_SCENE_SECONDS) <= 0.06);
    assert.deepEqual(JSON.parse(await fs.readFile(wordsPath, "utf8")), [
      { w: "locked", t: 2.75, d: 1.375 }
    ]);
  });
});
