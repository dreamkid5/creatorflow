// Locked storytime thumbnail generation.
// The opening hook appears as large outlined multicolour text on a white panel,
// with the exact same female presenter used by the video on the right.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANTON = path.join(HERE, "assets", "fonts", "Anton-Regular.ttf");
const MONTSERRAT = path.join(HERE, "assets", "fonts", "Montserrat-ExtraBold.ttf");

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

export function thumbnailHook(job = {}) {
  let hook = String(job.hook || "").trim();
  if (!hook) {
    const opening = String(job.script || "").trim().split(/\n\s*\n/)[0] || "";
    const sentence = opening.match(/^.*?[.!?](?:\s|$)/);
    hook = sentence ? sentence[0].trim() : opening;
  }
  return hook.replace(/\s+/g, " ").trim().split(" ").slice(0, 20).join(" ");
}

export async function buildThumbnail(job, cfg, workDir, outFile, deps) {
  if (!job.presenterFile || !fs.existsSync(job.presenterFile)) {
    throw new Error("the video's female presenter is missing");
  }
  const hook = thumbnailHook(job);
  if (!hook) throw new Error("the script opening hook is empty");
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
