// Locked storytime thumbnail generation.
// A short, two-beat story kicker appears as large outlined multicolour text on
// a white panel, with the exact same female presenter used by the video on the
// right. Automatic copy fails closed rather than publishing a flat opening
// sentence when a strong kicker cannot be produced.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANTON = path.join(HERE, "assets", "fonts", "Anton-Regular.ttf");
const MONTSERRAT = path.join(HERE, "assets", "fonts", "Montserrat-ExtraBold.ttf");
const MAX_LINE_WORDS = 6;
const MAX_TOTAL_WORDS = 11;

function findFont(cfg) {
  const list = [
    cfg.font,
    MONTSERRAT,
    ANTON,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf"
  ].filter(Boolean);
  for (const f of list) { try { if (fs.existsSync(f)) return f; } catch (e) {} }
  return null;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/[“”"]/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function wordCount(value) {
  return cleanLine(value).split(/\s+/).filter(Boolean).length;
}

export function validateThumbnailHook(value) {
  const lines = String(value || "").split("\n").map(cleanLine).filter(Boolean);
  if (lines.length !== 2 || lines[0] === lines[1]) return null;
  const counts = lines.map(wordCount);
  const total = counts[0] + counts[1];
  if (counts.some((count) => count < 2 || count > MAX_LINE_WORDS)) return null;
  if (total < 5 || total > MAX_TOTAL_WORDS) return null;
  const combined = lines.join(" ");
  const genericCopy = [
    /YOU WON'?T BELIEVE/,
    /WHAT HAPPENED NEXT/,
    /THE SHOCKING TRUTH/,
    /EVERYTHING CHANGED/,
    /I NEVER EXPECTED/,
    /THIS CHANGED EVERYTHING/
  ];
  if (genericCopy.some((pattern) => pattern.test(combined))) return null;
  return lines.join("\n");
}

function balancedLines(value) {
  const words = cleanLine(value).split(/\s+/).filter(Boolean).slice(0, MAX_TOTAL_WORDS);
  if (words.length < 5) return null;
  let split = Math.ceil(words.length / 2);
  const connectors = new Set(["BUT", "THEN", "UNTIL", "WHEN", "AFTER", "BECAUSE", "AND", "TO"]);
  for (let distance = 0; distance <= 2; distance++) {
    for (const candidate of [split - distance, split + distance]) {
      if (candidate >= 2 && candidate <= MAX_LINE_WORDS && connectors.has(words[candidate])) {
        split = candidate;
        distance = 3;
        break;
      }
    }
  }
  split = Math.max(2, Math.min(split, MAX_LINE_WORDS, words.length - 2));
  return validateThumbnailHook(words.slice(0, split).join(" ") + "\n" + words.slice(split).join(" "));
}

function manualThumbnailHook(value) {
  const parts = String(value || "").split(/\n|\s+[|/]\s+/).map(cleanLine).filter(Boolean);
  if (parts.length === 2) return validateThumbnailHook(parts.join("\n"));
  return null;
}

function extractHookJSON(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    return validateThumbnailHook(cleanLine(data.line1) + "\n" + cleanLine(data.line2));
  } catch (error) {
    return null;
  }
}

export function thumbnailHookPrompt(job = {}) {
  const title = String(job.title || "Untitled story").trim();
  const script = String(job.script || "").replace(/\s+/g, " ").trim().slice(0, 6000);
  return [
    "Write punchy, high-curiosity YouTube thumbnail copy for this first-person story.",
    "Reveal the strongest specific betrayal, secret, danger, or reversal that is true in the script.",
    "Return exactly two complementary headline lines. Each line must have 2 to 6 words; both lines together must have 5 to 11 words.",
    "Use vivid concrete language, active verbs, and uppercase. Do not copy a full opening sentence. Avoid generic teasers, filler, emojis, hashtags, names, and ending punctuation.",
    "The two lines must read as a setup and payoff, not as one flat sentence wrapped in the middle.",
    'Return only JSON: {"line1":"...","line2":"..."}',
    "",
    "TITLE: " + title,
    "SCRIPT: " + script
  ].join("\n");
}

export async function generateThumbnailHook(job = {}, cfg = {}, options = {}) {
  const manual = String(job.hook || "").trim();
  if (manual) {
    const formatted = manualThumbnailHook(manual);
    if (!formatted) throw new Error("thumbnail hook must form two punchy lines of 2-6 words each (5-11 total)");
    return formatted;
  }
  if (!cfg.anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY is required to create the locked two-line thumbnail kicker");
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const sleepFn = options.sleepFn || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": cfg.anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: cfg.seoModel || "claude-haiku-4-5-20251001",
          max_tokens: 160,
          temperature: 0.7,
          messages: [{ role: "user", content: thumbnailHookPrompt(job) }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const hook = extractHookJSON(data?.content?.[0]?.text);
        if (hook) return hook;
      }
      if (![429, 529].includes(response.status) && response.ok === false) break;
    } catch (error) {
      // A later attempt may recover from a transient network error.
    }
    if (attempt < 3) await sleepFn(1500 * attempt);
  }
  throw new Error("could not generate a valid two-line thumbnail kicker after 3 attempts");
}

export function thumbnailHook(job = {}) {
  const manual = String(job.hook || "").trim();
  if (manual) return manualThumbnailHook(manual) || "";
  return balancedLines(job.title || "") || "";
}

export async function buildThumbnail(job, cfg, workDir, outFile, deps) {
  if (!job.presenterFile || !fs.existsSync(job.presenterFile)) {
    throw new Error("the video's female presenter is missing");
  }
  const hook = await generateThumbnailHook(job, cfg, deps);
  if (typeof cfg.log === "function") cfg.log("  thumbnail kicker: " + hook.replace("\n", " / "));
  const font = findFont(cfg);
  if (!font) throw new Error("thumbnail font is missing");
  await deps.run(cfg.edgeCmd || "python3", [
    path.join(HERE, "thumbnail.py"),
    job.presenterFile,
    outFile,
    hook,
    font
  ]);
  return fs.existsSync(outFile) ? outFile : null;
}
