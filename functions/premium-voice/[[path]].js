// Cloudflare Pages Function: ElevenLabs premium voice proxy.
// The key stays server side. Set ELEVENLABS_API_KEY in the Pages environment.
export async function onRequest(context) {
  const { request, env } = context;
  if (!env.ELEVENLABS_API_KEY) return new Response("ElevenLabs key not set", { status: 500 });
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/premium-voice\//, "");
  const target = "https://api.elevenlabs.io/v1/text-to-speech/" + rest + url.search;
  const resp = await fetch(target, {
    method: request.method,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: request.method === "POST" ? await request.text() : undefined
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": resp.headers.get("content-type") || "audio/mpeg" } });
}
