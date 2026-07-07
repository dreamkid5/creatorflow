// SEO metadata generation using the Anthropic Claude API.
// Turns a narration script into an optimized YouTube title, description, and tags.
// Needs ANTHROPIC_API_KEY. If the key is missing or the call fails, it returns null
// and the pipeline falls back to the plain title and script.

function extractJSON(text) {
  if (!text) return null;
  // pull the first {...} block, tolerating any surrounding prose or code fences
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

export async function generateSEO(script, cfg) {
  if (!cfg.anthropicKey) return null;
  const clean = (script || "").trim();
  if (!clean) return null;

  const prompt =
    "You are a YouTube SEO expert. Read this video narration script and write metadata that ranks and earns clicks.\n\n" +
    "Return ONLY a JSON object, no prose, in exactly this shape:\n" +
    '{"title":"...","description":"...","tags":["...","..."]}\n\n' +
    "Rules:\n" +
    "- title: compelling, under 70 characters, front load the main keyword, no clickbait.\n" +
    "- description: 2 to 4 short natural paragraphs, weave in relevant search terms, end with a soft call to subscribe.\n" +
    "- tags: 15 to 20 specific, relevant search tags, lowercase, no hashes.\n" +
    "- Do not use the dash character anywhere in the title or description. Use commas or separate sentences instead.\n\n" +
    "Script:\n" + clean.slice(0, 6000);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": cfg.anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: cfg.seoModel,
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (attempt + 1))); continue; }
      if (!r.ok) { return null; }
      const j = await r.json();
      const text = j && j.content && j.content[0] && j.content[0].text;
      const data = extractJSON(text);
      if (!data || !data.title) return null;
      return {
        title: String(data.title).slice(0, 95),
        description: String(data.description || "").slice(0, 4800),
        tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : []
      };
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (attempt + 1))); }
  }
  return null;
}
