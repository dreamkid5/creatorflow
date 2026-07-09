// Rendering engine for the worker. Uses ffmpeg to turn scene images plus
// optional narration and music into a finished MP4. No browser required.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { splitScript, buildPrompt, styleKeywords, VOICES } from "./csv.mjs";
import { buildCharacterBible, sceneCharacterNote } from "./characters.mjs";
import { buildSceneVisuals } from "./visuals.mjs";
import { buildThumbnail } from "./thumbnail.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- asset fetching ----------
async function fetchImage(prompt, seed, outPath, cfg) {
  const token = cfg.imageToken ? "&token=" + encodeURIComponent(cfg.imageToken) : "";
  const url = cfg.imageBase + "/" + encodeURIComponent(prompt) + "?width=1280&height=720&nologo=true&model=" + cfg.imageModel + "&seed=" + seed + token;
  for (let attempt = 0; attempt < 6; attempt++) {
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

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function fetchTTS(script, voice, outPath, cfg) {
  try {
    // Local voice server: free, no card, no key, runs on your machine
    if (cfg.ttsProvider === "local" && cfg.localTtsUrl) {
      const r = await fetch(cfg.localTtsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: script }) });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // Azure Speech: 500k characters a month free, no card needed
    if (cfg.ttsProvider === "azure" && cfg.azureKey) {
      const name = voice || cfg.azureVoice;
      const lang = name.slice(0, 5);
      const ssml = "<speak version='1.0' xml:lang='" + lang + "'><voice xml:lang='" + lang + "' name='" + name + "'>" + xmlEscape(script) + "</voice></speak>";
      const r = await fetch("https://" + cfg.azureRegion + ".tts.speech.microsoft.com/cognitiveservices/v1", {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": cfg.azureKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "creatorflow-worker"
        },
        body: ssml
      });
      if (r.ok) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // Google Cloud Text to Speech: large free tier, great for volume
    if (cfg.ttsProvider === "google" && cfg.googleKey) {
      const name = voice || cfg.googleVoice;
      const lang = name.slice(0, 5);
      const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + cfg.googleKey, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text: script }, voice: { languageCode: lang, name }, audioConfig: { audioEncoding: "MP3" } })
      });
      if (r.ok) { const j = await r.json(); if (j.audioContent) { await fs.writeFile(outPath, Buffer.from(j.audioContent, "base64")); return true; } }
      return false;
    }
    // ElevenLabs: top quality, smaller free tier
    if (cfg.ttsProvider === "elevenlabs" && cfg.elevenKey) {
      const voiceId = voice && /^[A-Za-z0-9]{16,}$/.test(voice) ? voice : cfg.elevenVoice;
      const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": cfg.elevenKey, "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: script, model_id: "eleven_multilingual_v2" })
      });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // OpenAI compatible
    if (cfg.ttsKey) {
      const v = VOICES.includes((voice || "").toLowerCase()) ? voice.toLowerCase() : cfg.ttsVoice;
      const r = await fetch(cfg.ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.ttsKey },
        body: JSON.stringify({ model: cfg.ttsModel, voice: v, input: script, response_format: "mp3" })
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
    }
  } catch (e) { /* skip narration */ }
  return false;
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
// A single still becomes a gently zooming clip (Ken Burns).
// Uses a scale based zoom rather than the zoompan filter, which is dozens of
// times faster, so videos with many scenes render in minutes, not hours.
// The zoom direction alternates per scene for variety.
function kenBurnsClip(imgPath, outPath, dur, cfg, idx = 0) {
  const D = Math.max(0.1, dur);
  const z = (idx % 2 === 0) ? "(1+0.12*t/" + D + ")" : "(1.12-0.12*t/" + D + ")";
  const vf =
    "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720," +
    "scale=w='1280*" + z + "':h='720*" + z + "':eval=frame,crop=1280:720,format=yuv420p";
  return run(cfg.ffmpeg, ["-y", "-loop", "1", "-t", String(dur), "-i", imgPath, "-vf", vf, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", outPath]);
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
    await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", outPath]);
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("join produced no output");
  return outPath;
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
  const style = styleKeywords[job.style] ? job.style : cfg.style;

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
    visuals = await buildSceneVisuals(scenes, bible, cfg);
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
  const imgs = results.filter(Boolean);
  if (!imgs.length) throw new Error("no images were generated");

  let narration = null, total = null;
  if (cfg.ttsEnabled) {
    const np = path.join(workDir, "voice.mp3");
    if (await fetchTTS(job.script, job.voice, np, cfg)) { narration = np; total = await probeDuration(np, cfg); }
  }

  let music = null;
  if (job.music) music = await fetchMusic(job.music, path.join(workDir, "music.bin"));
  else if (cfg.music) music = cfg.music;

  const dur = total ? Math.max(2, total / imgs.length) : cfg.sceneSeconds;
  total = total || imgs.length * cfg.sceneSeconds;
  const TR = 0.6;

  cfg.log("  rendering " + imgs.length + " scenes with ffmpeg");
  const clips = [];
  for (let i = 0; i < imgs.length; i++) {
    const c = path.join(workDir, "clip" + i + ".mp4");
    try {
      await kenBurnsClip(imgs[i], c, dur, cfg, i);
      const st = await fs.stat(c);
      if (st.size > 1000) clips.push(c);
    } catch (e) {
      cfg.log("  scene clip " + (i + 1) + " skipped: " + String(e.message).slice(0, 90));
    }
  }
  if (!clips.length) throw new Error("no clips were rendered");
  const silent = path.join(workDir, "silent.mp4");
  await crossfadeConcat(clips, silent, dur, TR, cfg);

  // A narrated documentary must have its audio. If muxAudio cannot attach the
  // narration it throws, and this whole video is treated as failed (not uploaded)
  // so it gets retried, rather than ever saving or publishing a silent video.
  if (narration || music) await muxAudio(silent, narration, music, outFile, total, cfg);
  else await fs.copyFile(silent, outFile);

  // Auto thumbnail: a bold, professional 1280x720 image that matches the video.
  if (cfg.thumbnails) {
    try {
      const thumbFile = outFile.replace(/\.(mp4|webm)$/i, "-thumbnail.jpg");
      const t = await buildThumbnail(job, cfg, workDir, thumbFile, { fetchImage, run });
      if (t) { job.thumbnailFile = thumbFile; cfg.log("  thumbnail: " + path.basename(thumbFile)); }
    } catch (e) { cfg.log("  thumbnail skipped: " + e.message); }
  }

  return outFile;
}
