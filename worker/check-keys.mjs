// Checks the optional YouTube keys in your .env.
//   node check-keys.mjs
// Run it in whatever folder holds the .env you want to check.

try { process.loadEnvFile(); } catch (e) { /* no .env */ }

const log = (m) => console.log(m);

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
  log("Narration: Ava (locked, no key required)");
  let any = false;
  if (e.YT_CLIENT_ID && e.YT_CLIENT_SECRET && e.YT_REFRESH_TOKEN) { any = true; log("YouTube: " + await checkYouTube(e.YT_CLIENT_ID, e.YT_CLIENT_SECRET, e.YT_REFRESH_TOKEN)); }
  if (!any) log("No complete YouTube credentials found. Rendering remains available; uploads stay off.");
}

main().catch((e) => { console.error(e); process.exit(1); });
