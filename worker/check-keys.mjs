// Checks the keys in your .env and tells you which ones work.
//   node check-keys.mjs
// Run it in whatever folder holds the .env you want to check.

try { process.loadEnvFile(); } catch (e) { /* no .env */ }

const log = (m) => console.log(m);

async function checkEleven(key) {
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
    if (!r.ok) return "failed, status " + r.status + (r.status === 401 ? " (the key is wrong)" : "");
    const j = await r.json();
    const left = (j.character_limit || 0) - (j.character_count || 0);
    return "works. Plan " + (j.tier || "free") + ", " + left + " of " + (j.character_limit || 0) + " characters left this month";
  } catch (e) { return "could not reach ElevenLabs: " + e.message; }
}

async function checkGoogle(key) {
  try {
    const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + key, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text: "test" }, voice: { languageCode: "en-US", name: "en-US-Neural2-J" }, audioConfig: { audioEncoding: "MP3" } })
    });
    if (r.ok) { const j = await r.json(); return j.audioContent ? "works" : "failed, no audio returned"; }
    const t = await r.text();
    return "failed, status " + r.status + " " + t.slice(0, 140);
  } catch (e) { return "could not reach Google: " + e.message; }
}

async function checkAzure(key, region) {
  try {
    const ssml = "<speak version='1.0' xml:lang='en-US'><voice name='en-US-GuyNeural'>test</voice></speak>";
    const r = await fetch("https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1", {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "creatorflow" },
      body: ssml
    });
    return r.ok ? "works" : "failed, status " + r.status + (r.status === 401 ? " (check the key or region)" : "");
  } catch (e) { return "could not reach Azure: " + e.message; }
}

async function checkYouTube(id, secret, refresh) {
  try {
    const body = new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (r.ok) { const j = await r.json(); return j.access_token ? "works" : "failed, no token"; }
    return "failed, status " + r.status;
  } catch (e) { return "could not reach Google: " + e.message; }
}

async function main() {
  const e = process.env;
  log("Checking the keys in your .env");
  let any = false;
  if (e.ELEVENLABS_API_KEY) { any = true; log("ElevenLabs: " + await checkEleven(e.ELEVENLABS_API_KEY)); }
  if (e.GOOGLE_TTS_KEY) { any = true; log("Google: " + await checkGoogle(e.GOOGLE_TTS_KEY)); }
  if (e.AZURE_SPEECH_KEY) { any = true; log("Azure: " + await checkAzure(e.AZURE_SPEECH_KEY, e.AZURE_SPEECH_REGION || "eastus")); }
  if (e.YT_CLIENT_ID && e.YT_CLIENT_SECRET && e.YT_REFRESH_TOKEN) { any = true; log("YouTube: " + await checkYouTube(e.YT_CLIENT_ID, e.YT_CLIENT_SECRET, e.YT_REFRESH_TOKEN)); }
  if (!any) log("No keys found. Copy .env.example to .env and paste at least one key in.");
}

main().catch((e) => { console.error(e); process.exit(1); });
