// Rendering engine for the worker. Uses ffmpeg to turn scene images plus
// optional narration and music into a finished MP4. No browser required.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { splitScript, buildPrompt, styleKeywords, VOICES } from "./csv.mjs";

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
function kenBurnsClip(imgPath, outPath, dur, cfg) {
  const frames = Math.round(dur * 30);
  const vf =
    "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720," +
    "zoompan=z='min(zoom+0.0009,1.12)':d=" + frames +
    ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=30,format=yuv420p";
  return run(cfg.ffmpeg, ["-y", "-loop", "1", "-t", String(dur), "-i", imgPath, "-vf", vf, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", outPath]);
}

// Chain the clips together with crossfades.
function crossfadeConcat(clips, outPath, dur, TR, cfg) {
  if (clips.length === 1) return run(cfg.ffmpeg, ["-y", "-i", clips[0], "-c", "copy", outPath]);
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
  return run(cfg.ffmpeg, args);
}

// Lay narration and music under the finished visuals.
function muxAudio(video, narration, music, outPath, total, cfg) {
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
  args.push("-c:v", "copy");
  if (audioMap) args.push("-c:a", "aac", "-b:a", "160k");
  args.push("-t", String(total), outPath);
  return run(cfg.ffmpeg, args);
}

// ---------- orchestration ----------
export async function renderJob(job, cfg, workDir, outFile) {
  await fs.mkdir(workDir, { recursive: true });
  const scenes = splitScript(job.script);
  const style = styleKeywords[job.style] ? job.style : cfg.style;

  const imgs = [];
  for (let i = 0; i < scenes.length; i++) {
    const p = path.join(workDir, "img" + i + ".jpg");
    cfg.log("  scene " + (i + 1) + "/" + scenes.length + ": generating image");
    if (await fetchImage(buildPrompt(scenes[i], style), 3000 + i * 7, p, cfg)) imgs.push(p);
  }
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
    await kenBurnsClip(imgs[i], c, dur, cfg);
    clips.push(c);
  }
  const silent = path.join(workDir, "silent.mp4");
  await crossfadeConcat(clips, silent, dur, TR, cfg);

  if (narration || music) await muxAudio(silent, narration, music, outFile, total, cfg);
  else await fs.copyFile(silent, outFile);

  return outFile;
}
