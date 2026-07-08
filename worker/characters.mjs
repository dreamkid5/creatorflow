// Character consistency ("character bible").
// Claude reads the whole script once and writes a fixed visual description for
// each main recurring character. Then, for every scene, the description of any
// character present is injected into the image prompt, so the same person is
// drawn the same way across the whole video, even in scenes that only say "he".
// Needs ANTHROPIC_API_KEY. Returns null if unavailable, and the pipeline falls
// back to plain per-scene prompts.

function extractJSON(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

export async function buildCharacterBible(script, cfg) {
  if (!cfg.anthropicKey) return null;
  const clean = (script || "").trim();
  if (!clean) return null;

  const prompt =
    "You are the visual director for a narrated video. Read the full script and identify the main recurring characters, the people who appear across multiple scenes.\n\n" +
    "For each such character give:\n" +
    "- name: their common name.\n" +
    "- aliases: an array of every proper name, surname, rank, or title used for them in the script (proper nouns only, never pronouns like he or she).\n" +
    "- description: a fixed, concrete visual description an illustrator can reuse to draw them identically every time. Include approximate age, build, hair, face, and clothing appropriate to the era and setting, plus any distinctive features. About 20 to 30 words. Do not put their name inside the description.\n\n" +
    "Include at most the 4 most important recurring characters. If there are no real recurring human characters, return an empty list.\n\n" +
    "Return ONLY JSON in exactly this shape:\n" +
    '{"characters":[{"name":"...","aliases":["..."],"description":"..."}]}\n\n' +
    "Script:\n" + clean.slice(0, 9000);

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
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const text = j && j.content && j.content[0] && j.content[0].text;
      const data = extractJSON(text);
      if (!data || !Array.isArray(data.characters)) return null;
      // clean up and keep only usable entries
      const characters = data.characters
        .filter((c) => c && c.name && c.description)
        .slice(0, 4)
        .map((c) => ({
          name: String(c.name).trim(),
          aliases: Array.isArray(c.aliases) && c.aliases.length ? c.aliases.map((a) => String(a).trim()).filter(Boolean) : [String(c.name).trim()],
          description: String(c.description).trim()
        }));
      return { characters };
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (attempt + 1))); }
  }
  return null;
}

const PRONOUN = /\b(he|his|him|she|her|hers|they|them|their)\b/i;

// Returns the character description to append to a scene's image prompt, and
// carries the current main character forward so pronoun-only scenes still get it.
// state is a mutable object like { active: null }.
export function sceneCharacterNote(sceneText, bible, state) {
  const characters = (bible && bible.characters) || [];
  if (!characters.length) return "";
  const norm = " " + String(sceneText).toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const present = characters.filter((c) =>
    (c.aliases && c.aliases.length ? c.aliases : [c.name]).some((a) => a && norm.includes(" " + a.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " "))
  );
  let inject = [];
  if (present.length) { state.active = present[present.length - 1]; inject = present; }
  else if (PRONOUN.test(sceneText) && state.active) { inject = [state.active]; }
  if (!inject.length) return "";
  return ". Keep these characters visually identical in every scene: " +
    inject.map((c) => c.name + ", " + c.description).join("; ");
}
