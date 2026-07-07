// Cloudflare Pages Function: keyless AI image proxy.
// Replaces the dev server /ai-image proxy so image generation works on the live site.
// Requests to /ai-image/<prompt>?width=... are forwarded to Pollinations.
// If CF_IMAGE_TOKEN is set in the Pages environment, it unlocks the Flux model.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/ai-image\//, "");
  let search = url.search;
  if (env.CF_IMAGE_TOKEN) {
    search += (search ? "&" : "?") + "token=" + encodeURIComponent(env.CF_IMAGE_TOKEN);
  }
  const target = "https://image.pollinations.ai/prompt/" + rest + search;
  const resp = await fetch(target, { headers: { Accept: "image/*" } });
  const headers = new Headers();
  headers.set("Content-Type", resp.headers.get("content-type") || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(resp.body, { status: resp.status, headers });
}
