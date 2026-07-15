// Shared parsing logic for the background worker.
// Mirrors the Bulk Studio in the app so behavior stays consistent.

export const styleKeywords = {
  watercolor: "storybook illustration, clean bold ink outlines, flat soft watercolor fills, warm vivid palette, gentle cel shading, cream paper background with loose watercolor edges, editorial childrens book art, crisp and detailed, not photorealistic",
  cinematic: "cinematic photograph, dramatic lighting, film still, highly detailed, 35mm",
  storybook: "storybook painting, warm, painterly, whimsical",
  anime: "anime style, cel shaded, vibrant, detailed background",
  "3d": "3d render, soft studio lighting, subsurface scattering, pixar style",
  flat: "flat vector illustration, minimal, bold shapes, clean",
  oil: "oil painting, rich impasto brushstrokes, classical, textured canvas, warm light",
  pencil: "detailed pencil sketch, graphite shading, cross hatching, monochrome, hand drawn",
  comic: "comic book illustration, bold ink outlines, halftone dots, dynamic, vibrant colors",
  papercut: "layered paper cut art, soft drop shadows, tactile, handcrafted, clean edges",
  fantasy: "epic fantasy concept art, luminous atmosphere, highly detailed digital painting",
  vintage: "vintage photograph, faded film grain, nostalgic, sepia and muted tones",
  pixel: "pixel art, 16 bit retro game style, crisp pixels, limited palette",
  claymation: "claymation, plasticine clay model, stop motion, soft studio light",
  lineart: "elegant line art, minimal single weight lines, clean white background",
  synthwave: "synthwave retro futuristic, neon glow, purple and cyan, 1980s aesthetic",
  folktale: "African folktale illustration, rich earth tones, bold tribal patterns, Ndebele and Kente inspired motifs, warm ochre and indigo palette, textured, storytelling art"
};

export const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

// Parse CSV text into rows, handling quoted fields and commas.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

// Turn CSV text into a list of jobs. Columns: title, script, style, voice, music.
export function jobsFromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  let start = 0, ti = 0, si = 1, sti = 2, vi = -1, mi = -1;
  const first = rows[0].map((f) => f.trim().toLowerCase());
  if (first.indexOf("script") >= 0) {
    ti = first.indexOf("title"); si = first.indexOf("script"); sti = first.indexOf("style");
    vi = first.indexOf("voice"); mi = first.indexOf("music");
    if (ti < 0) ti = 0;
    start = 1;
  }
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const script = (r[si] || "").trim();
    if (!script) continue;
    out.push({
      title: (r[ti] || ("Video " + (out.length + 1))).trim(),
      script,
      style: (sti >= 0 && r[sti] ? r[sti].trim() : ""),
      voice: (vi >= 0 && r[vi] ? r[vi].trim() : ""),
      music: (mi >= 0 && r[mi] ? r[mi].trim() : "")
    });
  }
  return out;
}

// Split a script into scenes by paragraph, or by sentence when it is one block.
// Break a script into many scenes. It splits into sentences, then groups about
// one to two sentences per scene using a word target, so a long script yields
// lots of scenes rather than a few very long ones. Tunable with CF_SCENE_WORDS.
export function splitScript(text) {
  text = text.trim().replace(/[ \t]+/g, " ").replace(/\n+/g, " ");
  // break into clause level pieces at sentence enders AND commas, for fine control
  let pieces = text.split(/(?<=[.!?,;:])\s+/).map((s) => s.trim()).filter(Boolean);
  if (pieces.length < 2) pieces = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  let TARGET = Number(process.env.CF_SCENE_WORDS || 30); // words per scene
  // Safety budget: never make more images than can render inside the time limit.
  // Images are the slow step, so on a very long script we widen the scene (more
  // words each, fewer images) just enough to stay under the cap. Normal length
  // videos are unaffected and keep the short scenes. This means a render can
  // never run past the ceiling and get stuck retrying.
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  const MAX_IMAGES = Number(process.env.CF_MAX_IMAGES || 400);
  TARGET = Math.max(TARGET, Math.ceil(totalWords / MAX_IMAGES));
  const parts = [];
  let cur = "", words = 0;
  for (const p of pieces) {
    const w = p.split(/\s+/).filter(Boolean).length;
    cur = cur ? cur + " " + p : p;
    words += w;
    if (words >= TARGET) { parts.push(cur); cur = ""; words = 0; }
  }
  if (cur) parts.push(cur);
  const MAX = Number(process.env.CF_MAX_SCENES || 800); // safety ceiling only
  return parts.length ? parts.slice(0, MAX) : [text];
}

export function buildPrompt(scene, style) {
  return scene + ", " + (styleKeywords[style] || styleKeywords.watercolor);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "video";
}
