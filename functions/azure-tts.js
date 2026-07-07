// Cloudflare Pages Function: Microsoft Azure Speech proxy.
// Set AZURE_SPEECH_KEY and optionally AZURE_SPEECH_REGION in the Pages environment.
export async function onRequest(context) {
  const { request, env } = context;
  if (!env.AZURE_SPEECH_KEY) return new Response("Azure key not set", { status: 500 });
  const region = env.AZURE_SPEECH_REGION || "eastus";
  const body = await request.text();
  const resp = await fetch("https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1", {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
    },
    body
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "audio/mpeg" } });
}
