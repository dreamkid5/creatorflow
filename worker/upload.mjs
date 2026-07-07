// Uploads a finished video to YouTube with the Data API v3.
// Auth uses an OAuth refresh token, so no browser is needed at run time.
// Set YT_CLIENT_ID, YT_CLIENT_SECRET, and YT_REFRESH_TOKEN to enable it.

import fs from "node:fs/promises";

async function getAccessToken(cfg) {
  const body = new URLSearchParams({
    client_id: cfg.ytClientId,
    client_secret: cfg.ytClientSecret,
    refresh_token: cfg.ytRefreshToken,
    grant_type: "refresh_token"
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error("token exchange failed: " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  if (!j.access_token) throw new Error("no access token returned");
  return j.access_token;
}

function buildDescription(job, cfg) {
  // prefer the Claude generated SEO description, fall back to the script
  const base = (job.seoDescription || job.script || "").trim();
  const footer = cfg.ytFooter ? ("\n\n" + cfg.ytFooter) : "";
  return (base.length > 4500 ? base.slice(0, 4500) : base) + footer;
}

export async function uploadToYouTube(file, job, cfg) {
  const token = await getAccessToken(cfg);

  const meta = {
    snippet: {
      title: (job.title || "Untitled").slice(0, 95),
      description: buildDescription(job, cfg),
      tags: (job.seoTags && job.seoTags.length) ? job.seoTags : cfg.ytTags,
      categoryId: cfg.ytCategory
    },
    status: {
      privacyStatus: cfg.ytPrivacy,
      selfDeclaredMadeForKids: false
    }
  };

  // Start a resumable upload session.
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/*"
    },
    body: JSON.stringify(meta)
  });
  if (!start.ok) throw new Error("start upload failed: " + start.status + " " + (await start.text()).slice(0, 200));
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("no resumable upload URL was returned");

  // Send the bytes.
  const data = await fs.readFile(file);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "video/*", "Content-Length": String(data.length) },
    body: data
  });
  if (!put.ok) throw new Error("upload failed: " + put.status + " " + (await put.text()).slice(0, 200));
  const j = await put.json();
  return j.id;
}
