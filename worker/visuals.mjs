// Scene matching. Turns each stretch of narration into a concrete VISUAL image
// prompt, so the picture matches what is being said rather than the literal
// words. Claude reads the narration in batches, keeps the main characters
// consistent using the character bible, and returns one image prompt per scene.
// Needs ANTHROPIC_API_KEY. Returns null to fall back to plain per-scene prompts.

function extractJSON(text) {
  if (!text) return null;
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (x) { return null; }
}

async function ask(cfg, prompt, maxTokens) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.seoModel, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (a + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.content && j.content[0] && j.content[0].text;
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); }
  }
  return null;
}

export async function buildSceneVisuals(scenes, bible, cfg) {
  if (!cfg.anthropicKey || !scenes.length) return null;
  const chars = (bible && bible.characters) || [];
  const charBlock = chars.length
    ? ("Main recurring characters, draw each one consistently every time they appear:\n" +
        chars.map((c) => "- " + c.name + ": " + c.description).join("\n") + "\n\n")
    : "";

  const BATCH = 12;
  const out = new Array(scenes.length).fill(null);

  for (let start = 0; start < scenes.length; start += BATCH) {
    const batch = scenes.slice(start, start + BATCH);
    const numbered = batch.map((s, k) => (start + k + 1) + ". " + s).join("\n");
    const prompt =
      "You are the visual director and cinematographer for a narrated history documentary.\n\n" +
      charBlock +
      "Below are numbered narration segments. For EACH number, write ONE concrete visual image prompt describing what an illustrator should draw for that exact moment: a clear main subject, the setting, the action, and the mood, all matching the meaning of the narration.\n\n" +
      "Vary the SHOT TYPE from line to line like a real film edit. Choose whichever of these three best fits the moment, and do NOT use the same shot type several times in a row:\n" +
      "- CLOSE UP: a single face or one key object in close detail. Use it for emotion, a reaction, a decision, a personal moment, or an important object.\n" +
      "- FULL SHOT: one or a few figures shown full length, head to toe, doing something. Use it for action, movement, arriving, working, or fighting.\n" +
      "- WIDE SHOT: a sweeping establishing view of a place, landscape, city, army, or battlefield. Use it for setting the scene, scale, context, and transitions.\n" +
      "Start each prompt by naming the shot type in plain words, for example 'close up portrait of...', 'full body full length view of...', or 'wide establishing shot of...', so the framing is unmistakable.\n\n" +
      "Rules:\n" +
      "- Translate the meaning into a picture. Do NOT just repeat the narration words.\n" +
      "- When a main character appears, describe them using their fixed look above.\n" +
      "- For abstract, rhetorical, or transitional lines, pick a fitting symbolic or atmospheric image from the story's own world (often a WIDE view or an object CLOSE UP) rather than something literal.\n" +
      "- Never put on-screen text, captions, letters, or numbers in the image.\n" +
      "- Keep each prompt vivid but under about 45 words.\n\n" +
      "Return ONLY JSON covering every number in this batch, in this shape:\n" +
      '{"prompts":[{"n":<number>,"prompt":"..."}]}\n\n' +
      "Segments:\n" + numbered;

    const text = await ask(cfg, prompt, 2600);
    const data = extractJSON(text);
    if (data && Array.isArray(data.prompts)) {
      for (const p of data.prompts) {
        const idx = Number(p.n) - 1;
        if (idx >= 0 && idx < scenes.length && p && p.prompt) out[idx] = String(p.prompt).trim();
      }
    }
  }

  return out.some(Boolean) ? out : null;
}
