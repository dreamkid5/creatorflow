// Automatic thumbnail generation.
// Claude picks a punchy headline and a dramatic thumbnail image that matches the
// video, then ffmpeg composites a clean, bold 1280x720 YouTube thumbnail.
// Works without Claude too (headline derived from the title). Needs the image
// service and ffmpeg, both of which the pipeline already uses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleKeywords, buildPrompt } from "./csv.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Anton: a heavy condensed display font used on countless professional thumbnails.
const ANTON = path.join(HERE, "assets", "fonts", "Anton-Regular.ttf");

function extractJSON(text) {
  if (!text) return null;
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (x) { return null; }
}

// Ask Claude for a headline and a thumbnail image prompt that fit the video.
async function thumbnailPlan(job, cfg) {
  if (!cfg.anthropicKey) return null;
  const prompt =
    "You are designing a YouTube thumbnail for this video. Return ONLY JSON: " +
    '{"headline":"...","imagePrompt":"..."}\n' +
    "- headline: 2 to 4 punchy UPPERCASE words that spark curiosity. This text goes large on the thumbnail. No punctuation, no dash character.\n" +
    "- imagePrompt: one vivid, dramatic single scene that captures the hook of the video, described for an illustrator. One clear subject, strong emotion or action, close or medium shot, no text in the image.\n\n" +
    "Base both on this script:\n" + (job.script || job.title || "").slice(0, 5000);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.seoModel, max_tokens: 400, messages: [{ role: "user", content: prompt }] })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (a + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const data = extractJSON(j && j.content && j.content[0] && j.content[0].text);
      if (!data) return null;
      return { headline: String(data.headline || "").trim(), imagePrompt: String(data.imagePrompt || "").trim() };
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); }
  }
  return null;
}

function findFont(cfg) {
  const list = [
    cfg.font,
    ANTON,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf"
  ].filter(Boolean);
  for (const f of list) { try { if (fs.existsSync(f)) return f; } catch (e) {} }
  return null;
}

// clean to bold uppercase words, then wrap into 1 or 2 balanced lines
function toLines(headline, title) {
  let h = (headline || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!h) h = (title || "VIDEO").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  const words = h.split(" ").filter(Boolean).slice(0, 5);
  if (words.length <= 2 || h.length <= 12) return [words.join(" ")];
  // balance into two lines by character length
  let best = 1, bestDiff = 1e9;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

export async function buildThumbnail(job, cfg, workDir, outFile, deps) {
  const plan = await thumbnailPlan(job, cfg);
  const style = styleKeywords[job.style] ? job.style : cfg.style;
  const subject = (plan && plan.imagePrompt) || job.title || (job.script || "").slice(0, 120);
  const imgPrompt = buildPrompt(subject + ", dramatic, cinematic, bold, high contrast, striking, eye catching", style);
  const src = path.join(workDir, "thumb_src.jpg");
  if (!(await deps.fetchImage(imgPrompt, 9182, src, cfg))) return null;

  const lines = toLines(plan && plan.headline, job.title);
  const font = findFont(cfg);
  const maxLen = Math.max(...lines.map((l) => l.length));
  // Anton is condensed, so it carries a bigger size cleanly
  const fontsize = maxLen <= 10 ? 122 : maxLen <= 16 ? 100 : maxLen <= 22 ? 82 : 66;
  const lh = Math.round(fontsize * 1.14);
  const gradStart = 720 - (lines.length > 1 ? 340 : 240);

  // Cinematic bottom gradient (transparent to dark) instead of a flat black bar.
  let fc = "[1]format=rgba,geq=r=0:g=0:b=0:a='min(235,max(0,235*(Y-" + gradStart + ")/" + (720 - gradStart) + "))'[g];";
  fc += "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[v];";
  fc += "[v][g]overlay=format=auto";
  if (font && lines.length) {
    const draws = lines.map((ln, i) => {
      const fromBottom = 56 + (lines.length - 1 - i) * lh + fontsize;
      return "drawtext=fontfile='" + font + "':text='" + ln + "':fontcolor=white:fontsize=" + fontsize +
        ":borderw=9:bordercolor=black:shadowcolor=black@0.5:shadowx=5:shadowy=7:x=(w-text_w)/2:y=h-" + fromBottom;
    });
    fc += "," + draws.join(",");
  }
  fc += "[out]";
  await deps.run(cfg.ffmpeg, ["-y", "-i", src, "-f", "lavfi", "-i", "color=black:s=1280x720", "-filter_complex", fc, "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", outFile]);
  return fs.existsSync(outFile) ? outFile : null;
}
