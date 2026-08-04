// Rendering engine for the worker. Uses ffmpeg to turn scene images plus
// optional narration and music into a finished MP4. No browser required.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitScript, buildPrompt } from "./csv.mjs";
import { buildCharacterBible, sceneCharacterNote } from "./characters.mjs";
import { buildSceneVisuals } from "./visuals.mjs";
import { buildThumbnail } from "./thumbnail.mjs";
import {
  loadPresenterHistory,
  presenterHash,
  presenterAgeDescription,
  presenterSeed,
  presenterWasUsed,
  recordPresenter,
  resolvePresenterAge,
  validatePresenterAge,
  savePresenterHistory
} from "./presenter.mjs";
import {
  LOCKED_VOICE,
  LOCKED_VOICE_PITCH,
  LOCKED_VOICE_RATE
} from "./voice.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(HERE, "assets", "fonts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Production timing is locked: every future scene must occupy exactly 5.5
// seconds. Keep this independent of environment overrides so a workflow secret
// or an old local .env cannot silently change the channel's scene cadence.
export const LOCKED_SCENE_SECONDS = 5.5;

function ffEscapePath(value) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", rej);
    p.on("close", (code) => code === 0 ? res() : rej(new Error(cmd + " exited " + code + ": " + err.slice(-600))));
  });
}

function probeDuration(file, cfg) {
  return new Promise((res) => {
    const p = spawn(cfg.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("error", () => res(null));
    p.on("close", () => { const n = parseFloat(out.trim()); res(isFinite(n) && n > 0 ? n : null); });
  });
}

export function atempoFiltersForDuration(sourceDuration, targetDuration) {
  const source = Number(sourceDuration);
  const target = Number(targetDuration);
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(target) || target <= 0) {
    throw new Error("audio timing requires positive source and target durations");
  }
  let ratio = source / target;
  const filters = [];
  // Chaining within 0.5..2 keeps this compatible with older ffmpeg builds.
  while (ratio < 0.5) {
    filters.push("atempo=0.5");
    ratio /= 0.5;
  }
  while (ratio > 2) {
    filters.push("atempo=2");
    ratio /= 2;
  }
  filters.push("atempo=" + ratio.toFixed(8));
  return filters;
}

export function scaleWordTimings(words, sourceDuration, targetDuration) {
  const scale = Number(targetDuration) / Number(sourceDuration);
  if (!Array.isArray(words) || !words.length || !Number.isFinite(scale) || scale <= 0) {
    throw new Error("word timing scale is invalid");
  }
  return words.map((word) => {
    const t = Number(Math.min(
      Number(targetDuration),
      Math.max(0, Number(word.t || 0) * scale)
    ).toFixed(6));
    const d = Number(Math.min(
      Math.max(0, Number(targetDuration) - t),
      Math.max(0, Number(word.d || 0) * scale)
    ).toFixed(6));
    return { ...word, t, d };
  });
}

export async function lockNarrationDuration(audioPath, wordsPath, sourceDuration, cfg) {
  const target = LOCKED_SCENE_SECONDS;
  const timedPath = audioPath + ".locked.wav";
  const words = await readWordTimings(wordsPath);
  const filters = [
    ...atempoFiltersForDuration(sourceDuration, target),
    "apad=pad_dur=" + target,
    "atrim=duration=" + target
  ].join(",");
  try {
    await run(cfg.ffmpeg, [
      "-y", "-i", audioPath,
      "-filter:a", filters,
      "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
      timedPath
    ]);
    const duration = await probeDuration(timedPath, cfg);
    if (!duration || Math.abs(duration - target) > 0.06) {
      throw new Error("locked scene audio was " + duration + " seconds instead of " + target);
    }
    await fs.rename(timedPath, audioPath);
    await fs.writeFile(
      wordsPath,
      JSON.stringify(scaleWordTimings(words, sourceDuration, target))
    );
  } finally {
    await fs.rm(timedPath, { force: true }).catch(() => {});
  }
}

// ---------- asset fetching ----------
async function fetchImage(prompt, seed, outPath, cfg, opts = {}) {
  const token = cfg.imageToken ? "&token=" + encodeURIComponent(cfg.imageToken) : "";
  const width = Number(opts.width) || Number(cfg.width) || 1920;
  const height = Number(opts.height) || Number(cfg.height) || 1080;
  for (let attempt = 0; attempt < 6; attempt++) {
    const attemptSeed = seed + attempt * 104729;
    const url = cfg.imageBase + "/" + encodeURIComponent(prompt) +
      "?width=" + width + "&height=" + height + "&nologo=true&model=" +
      cfg.imageModel + "&seed=" + attemptSeed + token;
    try {
      const r = await fetch(url);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) { await fs.writeFile(outPath, buf); return true; }
      } else if (r.status === 429 || r.status === 503) {
        // rate limited or busy, wait longer and try again
        const ra = parseInt(r.headers.get("retry-after") || "0", 10);
        await sleep(ra > 0 ? Math.min(60000, ra * 1000) : Math.min(45000, 6000 * (attempt + 1)));
        continue;
      }
    } catch (e) { /* network hiccup, retry */ }
    await sleep(2500 * (attempt + 1));
  }
  return false;
}

function narrationParts(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return null;
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

async function readWordTimings(file) {
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(value) || !value.length) {
    throw new Error("word timings were empty");
  }
  return value;
}

async function mergeWordTimings(partFiles, durations, outFile) {
  const merged = [];
  let offset = 0;
  for (let i = 0; i < partFiles.length; i++) {
    const words = await readWordTimings(partFiles[i]);
    for (const word of words) {
      merged.push({ ...word, t: Number(word.t || 0) + offset });
    }
    offset += Number(durations[i] || 0);
  }
  await fs.writeFile(outFile, JSON.stringify(merged));
}

// Edge TTS is a remote streaming service. A long video can require hundreds of
// independent calls, so one transient websocket or throttling failure must not
// discard hours of work. Every clip is retried in a fresh Python process with
// exponential backoff and validated for both audio and word timings. If a line
// repeatedly fails, it is split into two smaller requests and reassembled.
export async function fetchTTS(script, outPath, cfg, options = {}) {
  const text = String(script || "").trim();
  if (!text) throw new Error("narration text is empty");

  const label = options.label || "narration";
  const runCommand = options.runCommand || run;
  const sleepFn = options.sleepFn || sleep;
  const probeDurationFn = options.probeDurationFn || ((file) => probeDuration(file, cfg));
  const concatAudioFn = options.concatAudioFn || ((files, file) => concatAudio(files, file, cfg));
  const maxAttempts = Math.max(
    1,
    Number(options.maxAttempts || process.env.CF_TTS_ATTEMPTS || 8)
  );
  const retryBaseMs = Math.max(
    0,
    Number(options.retryBaseMs ?? process.env.CF_TTS_RETRY_BASE_MS ?? 2500)
  );
  const textFile = outPath + ".txt";
  const wordsFile = outPath + ".words.json";
  let lastError = new Error("unknown Edge TTS error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await fs.rm(outPath, { force: true }).catch(() => {});
    await fs.rm(wordsFile, { force: true }).catch(() => {});
    await fs.writeFile(textFile, text);
    try {
      await runCommand(cfg.edgeCmd || "python3", [
        path.join(HERE, "tts_words.py"),
        textFile,
        LOCKED_VOICE,
        outPath,
        wordsFile,
        LOCKED_VOICE_RATE,
        LOCKED_VOICE_PITCH
      ]);
      const stat = await fs.stat(outPath).catch(() => null);
      if (!stat || stat.size <= 1000) throw new Error("audio output was empty");
      await readWordTimings(wordsFile);
      const duration = await probeDurationFn(outPath);
      if (!duration || duration <= 0) throw new Error("audio duration was invalid");
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const waitMs = Math.min(30000, retryBaseMs * (2 ** (attempt - 1)));
        cfg.log(
          "  Ava " + label + " attempt " + attempt + "/" + maxAttempts +
          " failed (" + lastError.message.slice(0, 140) + "); retrying in " +
          Math.round(waitMs / 1000) + "s"
        );
        await sleepFn(waitMs);
      }
    } finally {
      await fs.rm(textFile, { force: true }).catch(() => {});
    }
  }

  if (options.allowSplit !== false) {
    const parts = narrationParts(text);
    if (parts) {
      cfg.log("  Ava " + label + " is using the two-part recovery path");
      const partAudio = parts.map(
        (_part, index) => outPath + ".recovery-" + (index + 1) + ".mp3"
      );
      const partWords = partAudio.map((file) => file + ".words.json");
      const partDurations = [];
      try {
        for (let i = 0; i < parts.length; i++) {
          const partPath = partAudio[i];
          await fetchTTS(parts[i], partPath, cfg, {
            ...options,
            allowSplit: false,
            label: label + " recovery part " + (i + 1),
            maxAttempts: Math.max(4, Math.ceil(maxAttempts / 2))
          });
          partDurations.push(await probeDurationFn(partPath));
        }
        await concatAudioFn(partAudio, outPath);
        await mergeWordTimings(partWords, partDurations, wordsFile);
        const duration = await probeDurationFn(outPath);
        if (!duration || duration <= 0) throw new Error("recovered audio duration was invalid");
        return true;
      } finally {
        for (const file of [...partAudio, ...partWords]) {
          await fs.rm(file, { force: true }).catch(() => {});
        }
      }
    }
  }

  throw new Error(
    "Ava could not generate " + label + " after " + maxAttempts +
    " fresh attempts: " + lastError.message
  );
}

async function fetchMusic(url, outPath) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("audio") && !/\.(mp3|m4a|ogg|wav)($|\?)/i.test(url)) return null;
    await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer()));
    return outPath;
  } catch (e) { return null; }
}

// ---------- ffmpeg steps ----------
function kenBurnsVfSize(dur, cfg, idx, width, height) {
  const D = Math.max(0.1, dur);
  const zoom = Math.min(0.2, Math.max(0, Number(cfg.zoom) || 0.06));
  const high = (1 + zoom).toFixed(3);
  const z = idx % 2 === 0
    ? "(1+" + zoom + "*t/" + D + ")"
    : "(" + high + "-" + zoom + "*t/" + D + ")";
  return "scale=" + width + ":" + height +
    ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + "," +
    "scale=w='" + width + "*" + z + "':h='" + height + "*" + z +
    "':eval=frame,crop=" + width + ":" + height + ",setsar=1";
}

function kenBurnsVf(dur, cfg, idx) {
  return kenBurnsVfSize(
    dur,
    cfg,
    idx,
    Number(cfg.width) || 1920,
    Number(cfg.height) || 1080
  ) + ",format=yuv420p";
}

function kenBurnsClip(imgPath, outPath, dur, cfg, idx = 0) {
  return run(cfg.ffmpeg, [
    "-y", "-loop", "1", "-t", String(dur), "-i", imgPath,
    "-vf", kenBurnsVf(dur, cfg, idx),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast",
    "-crf", String(Number(cfg.crf) || 20), "-pix_fmt", "yuv420p", outPath
  ]);
}

function presenterVf(dur, cfg, idx, width, height) {
  const zoom = Math.min(0.12, Math.max(0, Number(cfg.presenterZoom) || 0));
  if (!zoom) {
    return "scale=" + width + ":" + height +
      ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1";
  }
  return kenBurnsVfSize(dur, { ...cfg, zoom }, idx, width, height);
}

// Presenter on the left, narration-matched scene on the right, and highlighted
// captions across the full frame. Each scene carries its own audio to prevent drift.
function storySceneClip(presenter, story, audio, captions, outPath, dur, cfg, idx = 0) {
  const width = Number(cfg.width) || 1920;
  const height = Number(cfg.height) || 1080;
  const presenterWidth = Math.round(width * 0.38);
  const storyWidth = width - presenterWidth;
  const args = ["-y"];
  if (presenter) args.push("-loop", "1", "-t", String(dur), "-i", presenter);
  args.push("-loop", "1", "-t", String(dur), "-i", story);
  const audioIndex = presenter ? 2 : 1;
  if (audio) args.push("-i", audio);
  else args.push(
    "-f", "lavfi", "-t", String(dur), "-i",
    "anullsrc=channel_layout=mono:sample_rate=24000"
  );

  const subtitleFilter = captions
    ? ",subtitles='" + ffEscapePath(captions) + "':fontsdir='" + ffEscapePath(FONTS_DIR) + "'"
    : "";
  let filter;
  if (presenter) {
    filter =
      "[0:v]" + presenterVf(dur, cfg, idx, presenterWidth, height) + "[left];" +
      "[1:v]" + kenBurnsVfSize(dur, cfg, idx, storyWidth, height) + "[right];" +
      "[left][right]hstack=inputs=2,format=yuv420p" + subtitleFilter + "[video]";
  } else {
    filter = "[0:v]" + kenBurnsVf(dur, cfg, idx) + subtitleFilter + "[video]";
  }
  args.push(
    "-filter_complex", filter,
    "-map", "[video]", "-map", audioIndex + ":a:0",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast",
    "-crf", String(Number(cfg.crf) || 20), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "24000", "-ac", "1",
    "-t", String(dur), outPath
  );
  return run(cfg.ffmpeg, args);
}

async function findCaptionFont(cfg) {
  const locked = {
    path: path.join(FONTS_DIR, "Montserrat-ExtraBold.ttf"),
    family: "Montserrat ExtraBold"
  };
  return await fs.stat(locked.path).catch(() => null) ? locked : null;
}

async function buildSceneCaptions(wordsFile, assPath, cfg) {
  const font = await findCaptionFont(cfg);
  if (!font) throw new Error("no caption font found");
  const width = Number(cfg.width) || 1920;
  const height = Number(cfg.height) || 1080;
  const fontSize = Math.round(height * 0.06);
  await run(cfg.edgeCmd || "python3", [
    path.join(HERE, "captions.py"),
    wordsFile,
    assPath,
    String(width),
    String(height),
    font.path,
    font.family,
    String(fontSize),
    "#7B14D1",
    "4",
    "0.72"
  ]);
}

async function mixMusicUnder(video, music, total, outPath, cfg) {
  await run(cfg.ffmpeg, [
    "-y", "-i", video, "-stream_loop", "-1", "-i", music,
    "-filter_complex",
    "[1:a]volume=0.28[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[audio]",
    "-map", "0:v", "-map", "[audio]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-t", String(total), outPath
  ]);
  return outPath;
}

// Join clips with clean hard cuts, no re-encode. Scales to any number of clips.
async function fastConcat(clips, outPath, cfg) {
  // keep only clips that actually exist and are non trivial
  const good = [];
  for (const c of clips) { try { const st = await fs.stat(c); if (st.size > 1000) good.push(c); } catch (e) {} }
  if (!good.length) throw new Error("no valid clips to join");
  const listFile = path.join(path.dirname(outPath), "concat_list.txt");
  // absolute paths so the concat demuxer resolves them correctly regardless of cwd
  await fs.writeFile(listFile, good.map((c) => "file '" + path.resolve(c).replace(/'/g, "'\\''") + "'").join("\n"));
  try {
    await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
  } catch (e) {
    // fallback: re-encode on join, which tolerates any small differences between clips
    cfg.log("  fast join fell back to a re-encode");
    await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", String(Number(cfg.crf) || 20), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", outPath]);
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("join produced no output");
  return outPath;
}

// Join the per scene voice clips into one continuous narration track, in order.
async function concatAudio(files, outPath, cfg) {
  if (!files.length) throw new Error("no voice clips to join");
  const listFile = path.join(path.dirname(outPath), "audio_list.txt");
  await fs.writeFile(listFile, files.map((f) => "file '" + path.resolve(f).replace(/'/g, "'\\''") + "'").join("\n"));
  await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-ar", "44100", "-ac", "1", outPath]);
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 200) throw new Error("joining the voice clips produced nothing");
  return outPath;
}

// A short clip of pure silence. Used when one line's narration cannot be made,
// so the picture track and the voice track stay the same length and in step.
function silenceClip(outPath, dur, cfg) {
  return run(cfg.ffmpeg, ["-y", "-f", "lavfi", "-t", String(Math.max(0.3, dur)), "-i", "anullsrc=r=22050:cl=mono", "-c:a", "pcm_s16le", outPath]);
}

// Chain the clips together. Crossfades for a handful of scenes; clean hard cuts
// for many short scenes, which is fast, reliable, and the standard punchy look.
async function crossfadeConcat(clips, outPath, dur, TR, cfg) {
  if (clips.length === 1) return run(cfg.ffmpeg, ["-y", "-i", clips[0], "-c", "copy", outPath]);
  const maxXfade = Number(process.env.CF_MAX_CROSSFADE || 60);
  if (clips.length > maxXfade) return fastConcat(clips, outPath, cfg);
  const args = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  let filter = "", last = "";
  for (let k = 0; k < clips.length - 1; k++) {
    const off = ((k + 1) * (dur - TR)).toFixed(3);
    const outLbl = "vx" + k;
    const inLbl = k === 0 ? "[0:v][1:v]" : "[" + last + "][" + (k + 1) + ":v]";
    filter += inLbl + "xfade=transition=fade:duration=" + TR + ":offset=" + off + "[" + outLbl + "];";
    last = outLbl;
  }
  filter = filter.replace(/;$/, "");
  args.push("-filter_complex", filter, "-map", "[" + last + "]", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", outPath);
  try {
    await run(cfg.ffmpeg, args);
  } catch (e) {
    // if the crossfade graph ever errors, fall back to the simple, always-works join
    cfg.log("  crossfade failed, using the simple join instead");
    return fastConcat(clips, outPath, cfg);
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) return fastConcat(clips, outPath, cfg);
  return outPath;
}

// True only if the file has an audio stream.
function hasAudioStream(file, cfg) {
  return new Promise((res) => {
    const p = spawn(cfg.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("error", () => res(false));
    p.on("close", () => res(out.includes("audio")));
  });
}

// Lay narration and music under the finished visuals. A narrated documentary MUST
// end up with audio, so this retries with a re-encode and then verifies the output
// truly has an audio stream. If narration cannot be attached, it throws, and the
// caller fails the video (to be retried) rather than ever saving a silent one.
async function muxAudio(video, narration, music, outPath, total, cfg) {
  function build(reencode) {
    const args = ["-y", "-i", video];
    if (narration) args.push("-i", narration);
    if (music) args.push("-stream_loop", "-1", "-i", music);
    const nIdx = narration ? 1 : null;
    const mIdx = music ? (narration ? 2 : 1) : null;
    let filter = null, audioMap = null;
    if (narration && music) {
      filter = "[" + mIdx + ":a]volume=0.35[m];[" + nIdx + ":a][m]amix=inputs=2:duration=first:dropout_transition=0[aout]";
      audioMap = "[aout]";
    } else if (narration) {
      audioMap = nIdx + ":a";
    } else if (music) {
      filter = "[" + mIdx + ":a]volume=0.5[aout]";
      audioMap = "[aout]";
    }
    if (filter) args.push("-filter_complex", filter);
    args.push("-map", "0:v");
    if (audioMap) args.push("-map", audioMap);
    args.push("-c:v", reencode ? "libx264" : "copy");
    if (reencode) args.push("-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
    if (audioMap) args.push("-c:a", "aac", "-b:a", "160k");
    args.push("-t", String(total), outPath);
    return args;
  }
  try {
    await run(cfg.ffmpeg, build(false));
  } catch (e) {
    cfg.log("  audio step retrying with a re-encode");
    await run(cfg.ffmpeg, build(true));
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("the audio step produced no output");
  // a narrated video with no audio is useless, so treat that as a failure
  if (narration && !(await hasAudioStream(outPath, cfg))) {
    throw new Error("the narration did not attach to the video");
  }
  return outPath;
}

// ---------- orchestration ----------
export async function renderJob(job, cfg, workDir, outFile) {
  await fs.mkdir(workDir, { recursive: true });
  const scenes = splitScript(job.script);
  cfg.log("  scene duration: locked to " + LOCKED_SCENE_SECONDS + " seconds each");
  const style = "story";
  const storyMode = true;

  let presenter = null;
  if (storyMode) {
    if (!cfg.anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the locked presenter-age check");
    }
    const ageResult = await resolvePresenterAge(job, cfg);
    job.presenterAge = ageResult.age;
    cfg.log("  presenter age target: " + ageResult.age + " (" + ageResult.source + ")");
    const description =
      "one friendly relatable white adult woman, " + presenterAgeDescription(ageResult.age) +
      ", clearly European appearance, unmistakably female, age-appropriate facial features and natural skin texture, natural shoulder-length hair, plain soft grey modern top, no man, no male person";
    const prompt = "cinematic photorealistic upper body portrait of " + description +
      ", warm genuine calm expression, facing the camera, soft natural indoor lighting, " +
      "softly blurred cosy home background, shallow depth of field, 35mm, highly detailed " +
      "realistic skin and face, centered head and shoulders, not an illustration";
    const presenterPath = path.join(workDir, "presenter.jpg");
    const history = await loadPresenterHistory(cfg.presenterHistory);
    const startNonce = history.nextNonce;
    for (let attempt = 0; attempt < 20 && !presenter; attempt++) {
      const nonce = startNonce + attempt;
      const seed = presenterSeed(job, nonce);
      const generated = await fetchImage(prompt, seed, presenterPath, cfg, {
        width: 768,
        height: 1024
      });
      if (!generated) continue;
      const hash = await presenterHash(presenterPath);
      if (presenterWasUsed(history, seed, hash)) {
        cfg.log("  presenter duplicate rejected; generating another woman");
        continue;
      }
      const ageCheck = await validatePresenterAge(presenterPath, ageResult.age, cfg);
      if (!ageCheck.match) {
        cfg.log("  presenter age mismatch rejected: target " + ageResult.age +
          ", visible estimate " + (ageCheck.estimatedAge || "unknown") +
          "; generating another woman");
        continue;
      }
      presenter = presenterPath;
      job.presenterFile = presenterPath;
      job.presenterSeed = seed;
      recordPresenter(history, job, seed, hash, nonce);
      await savePresenterHistory(cfg.presenterHistory, history);
    }
    if (!presenter) {
      throw new Error("age-matched white female presenter generation failed; refusing to render with a mismatched presenter");
    }
    cfg.log("  presenter: ready (age " + ageResult.age + " white woman, left panel)");
  }

  // Character bible: keep the main characters looking the same across scenes.
  let bible = null;
  if (cfg.anthropicKey && cfg.characters !== false) {
    bible = await buildCharacterBible(job.script, cfg);
    if (bible && bible.characters.length) cfg.log("  character bible: " + bible.characters.map((c) => c.name).join(", "));
  }

  // Scene matching: turn each stretch of narration into a concrete VISUAL prompt so
  // the image matches the meaning, not the literal words. Falls back to raw text.
  let visuals = null;
  if (cfg.anthropicKey && cfg.sceneVisuals !== false) {
    visuals = await buildSceneVisuals(scenes, bible, cfg, style);
    if (visuals) cfg.log("  scene matching: on (" + visuals.filter(Boolean).length + "/" + scenes.length + " scenes visualized)");
  }
  // Build each scene's image prompt first (sequentially, so the character carry
  // forward stays correct), then fetch the images several at a time for speed.
  const charState = { active: null };
  const prompts = scenes.map((s, i) =>
    (visuals && visuals[i]) ? visuals[i] : (s + sceneCharacterNote(s, bible, charState)));

  const results = new Array(scenes.length).fill(null);
  const CONC = Math.max(1, Number(process.env.CF_IMG_CONCURRENCY || 2));
  let next = 0, done = 0;
  async function imgWorker() {
    while (true) {
      const i = next++;
      if (i >= scenes.length) return;
      const p = path.join(workDir, "img" + i + ".jpg");
      if (await fetchImage(buildPrompt(prompts[i], style), 3000 + i * 7, p, cfg)) results[i] = p;
      done++;
      if (done % 20 === 0 || done === scenes.length) cfg.log("  images " + done + "/" + scenes.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, scenes.length) }, imgWorker));
  const firstImg = results.find(Boolean);
  if (!firstImg) throw new Error("no images were generated");

  // Pair every scene with an image and its own narration line. If an image
  // failed, reuse the previous one, so no narration is dropped and the pictures
  // stay locked to the words.
  const items = [];
  let lastImg = firstImg;
  for (let i = 0; i < scenes.length; i++) {
    if (results[i]) lastImg = results[i];
    items.push({ img: lastImg, text: scenes[i], dur: 0, audio: null, words: null });
  }

  let music = null;
  if (job.music) music = await fetchMusic(job.music, path.join(workDir, "music.bin"));
  else if (cfg.music) music = cfg.music;

  // Narration is generated per scene, then time-fitted to the locked 5.5-second
  // production cadence. Word timings are scaled with the audio so highlighted
  // captions remain synchronized and no narration is clipped.
  let narration = null, total = null;
  if (cfg.ttsEnabled) {
    cfg.log("  narrating " + items.length + " lines, one voice clip each");
    const voiceClips = [];
    const pacingMs = Math.max(0, Number(process.env.CF_TTS_PACING_MS ?? 200));
    for (let i = 0; i < items.length; i++) {
      const ap = path.join(workDir, "a" + i + ".wav");
      if (!items[i].text) throw new Error("scene narration is empty");
      try {
        await fetchTTS(items[i].text, ap, cfg, {
          label: "scene " + (i + 1) + "/" + items.length
        });
      } catch (error) {
        throw new Error(
          "locked Ava narration failed for scene " + (i + 1) +
          " after all recovery attempts: " + error.message
        );
      }
      const d = await probeDuration(ap, cfg) || 0;
      if (d <= 0) throw new Error("Ava narration duration is invalid for scene " + (i + 1));
      const wordsFile = ap + ".words.json";
      await lockNarrationDuration(ap, wordsFile, d, cfg);
      items[i].dur = LOCKED_SCENE_SECONDS;
      items[i].audio = ap;
      items[i].words = wordsFile;
      voiceClips.push(ap);
      if ((i + 1) % 25 === 0 || i + 1 === items.length) {
        cfg.log("  narration " + (i + 1) + "/" + items.length);
      }
      // A tiny gap between requests prevents hundreds of back-to-back websocket
      // sessions from looking like a burst and being throttled by Edge TTS.
      if (pacingMs && i + 1 < items.length) await sleep(pacingMs);
    }
    const np = path.join(workDir, "voice.mp3");
    try { await concatAudio(voiceClips, np, cfg); narration = np; total = await probeDuration(np, cfg); }
    catch (e) { cfg.log("  per scene voice join failed (" + e.message + "), using one narration"); }
  }
  // Fallback: a single whole-script narration, time-fitted to the exact combined
  // duration of all 5.5-second scenes.
  if (cfg.ttsEnabled && !narration) {
    const np = path.join(workDir, "voice.mp3");
    try {
      await fetchTTS(job.script, np, cfg, { label: "whole-script fallback" });
      const sourceDuration = await probeDuration(np, cfg);
      if (!sourceDuration) throw new Error("whole-script narration duration is invalid");
      const targetTotal = items.length * LOCKED_SCENE_SECONDS;
      const timedPath = np + ".locked.mp3";
      const filters = [
        ...atempoFiltersForDuration(sourceDuration, targetTotal),
        "apad=pad_dur=" + targetTotal,
        "atrim=duration=" + targetTotal
      ].join(",");
      try {
        await run(cfg.ffmpeg, [
          "-y", "-i", np, "-filter:a", filters,
          "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", timedPath
        ]);
        await fs.rename(timedPath, np);
      } finally {
        await fs.rm(timedPath, { force: true }).catch(() => {});
      }
      narration = np;
      total = targetTotal;
      items.forEach((it) => { it.dur = LOCKED_SCENE_SECONDS; });
    } catch (error) {
      throw new Error("Ava whole-script fallback failed: " + error.message);
    }
  }
  // No narration at all: fixed length per scene.
  items.forEach((it) => { if (!it.dur || it.dur <= 0) it.dur = LOCKED_SCENE_SECONDS; });
  total = total || items.reduce((s, it) => s + it.dur, 0);

  cfg.log("  rendering " + items.length + " scenes with ffmpeg" +
    (storyMode ? " (presenter + highlighted captions)" : ""));
  const clips = [];
  for (let i = 0; i < items.length; i++) {
    const c = path.join(workDir, "clip" + i + ".mp4");
    try {
      if (storyMode) {
        let captions = null;
        if (items[i].words && await fs.stat(items[i].words).catch(() => null)) {
          captions = path.join(workDir, "captions" + i + ".ass");
          try {
            await buildSceneCaptions(items[i].words, captions, cfg);
          } catch (error) {
            captions = null;
            cfg.log("  captions skipped scene " + (i + 1) + ": " +
              String(error.message).slice(0, 90));
          }
        }
        await storySceneClip(
          presenter,
          items[i].img,
          items[i].audio,
          captions,
          c,
          items[i].dur,
          cfg,
          i
        );
      } else {
        await kenBurnsClip(items[i].img, c, items[i].dur, cfg, i);
      }
      const st = await fs.stat(c);
      if (st.size > 1000) clips.push(c);
    } catch (e) {
      cfg.log("  scene clip " + (i + 1) + " skipped: " + String(e.message).slice(0, 90));
    }
  }
  if (!clips.length) throw new Error("no clips were rendered");
  // Hard cuts, so every image stays pinned to its line. A crossfade would slide
  // the pictures steadily earlier, which is the drift we are removing.
  if (storyMode) {
    const joined = music ? path.join(workDir, "story-joined.mp4") : outFile;
    await fastConcat(clips, joined, cfg);
    if (music) await mixMusicUnder(joined, music, total, outFile, cfg);
    if (cfg.ttsEnabled && !(await hasAudioStream(outFile, cfg))) {
      throw new Error("the narration did not attach to the storytime video");
    }
  } else {
    const silent = path.join(workDir, "silent.mp4");
    await fastConcat(clips, silent, cfg);
    // A narrated documentary must have its audio. If muxAudio cannot attach the
    // narration it throws so a silent video is never published.
    if (narration || music) await muxAudio(silent, narration, music, outFile, total, cfg);
    else await fs.copyFile(silent, outFile);
  }

  // Auto thumbnail: a bold, professional 1280x720 image that matches the video.
  if (cfg.thumbnails) {
    const thumbFile = outFile.replace(/\.(mp4|webm)$/i, "-thumbnail.jpg");
    const t = await buildThumbnail(job, cfg, workDir, thumbFile, { run });
    if (!t) throw new Error("the required presenter thumbnail was not created");
    job.thumbnailFile = thumbFile;
    cfg.log("  thumbnail: " + path.basename(thumbFile) + " (two-beat kicker + same presenter)");
  }

  return outFile;
}
