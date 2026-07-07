// Cloudflare Pages Function: Google Cloud Text to Speech proxy.
// Set GOOGLE_TTS_KEY in the Pages environment.
export async function onRequest(context) {
  const { request, env } = context;
  if (!env.GOOGLE_TTS_KEY) return new Response("Google key not set", { status: 500 });
  const body = await request.text();
  const resp = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + env.GOOGLE_TTS_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "application/json" } });
}
