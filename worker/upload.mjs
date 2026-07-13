// Uploads a finished video to YouTube with the Data API v3.
// Auth uses an OAuth refresh token, so no browser is needed at run time.
// Set YT_CLIENT_ID, YT_CLIENT_SECRET, and YT_REFRESH_TOKEN to enable it.

import fs from "node:fs/promises";
import path from "node:path";
import { slug } from "./csv.mjs";

// A small ledger, committed with the content folder, that maps each script
// (by its file name based slug, which never changes when you rename the video
// on YouTube) to the uploaded video id. This is the rename proof duplicate
// guard: even if you retitle a video, its script still points at it here.
const LEDGER = ".cf-uploaded.json";

async function loadLedger(cfg) {
  try { return JSON.parse(await fs.readFile(path.join(cfg.input || ".", LEDGER), "utf8")); }
  catch (e) { return {}; }
}
async function saveLedger(cfg, map) {
  try { await fs.writeFile(path.join(cfg.input || ".", LEDGER), JSON.stringify(map, null, 2)); }
  catch (e) { /* non fatal, the title guard still applies */ }
}

// Confirm a recorded video id still exists on the channel. If you deleted the
// video, this returns false so the script is allowed to upload again.
async function videoExists(token, id) {
  try {
    const r = await fetch("https://www.googleapis.com/youtube/v3/videos?part=id&id=" + id, {
      headers: { "Authorization": "Bearer " + token }
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.items && j.items.length);
  } catch (e) { return false; }
}

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

// The channel's uploads playlist holds every video, including private drafts.
async function getUploadsPlaylist(token) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", {
    headers: { "Authorization": "Bearer " + token }
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.items && j.items[0] && j.items[0].contentDetails.relatedPlaylists.uploads) || null;
}

// Look through the most recent uploads for a video with this exact title.
// Returns its video id if found, else null. Any failure returns null so the
// upload still goes ahead: a rare duplicate is better than a missed video.
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

async function findExistingUpload(token, title) {
  try {
    const pl = await getUploadsPlaylist(token);
    if (!pl) return null;
    const want = norm(title);
    if (!want) return null;
    let pageToken = "";
    for (let page = 0; page < 3; page++) { // scan up to the 150 newest uploads
      const url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=" +
        pl + (pageToken ? "&pageToken=" + pageToken : "");
      const r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
      if (!r.ok) return null;
      const j = await r.json();
      for (const it of (j.items || [])) {
        const t = norm(it.snippet && it.snippet.title);
        // exact match, or the video title still contains the original title
        // (covers your edits like new capitals or an appended subtitle)
        if (t && (t === want || t.includes(want))) {
          return (it.snippet.resourceId && it.snippet.resourceId.videoId) || null;
        }
      }
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
  } catch (e) { /* fall through and upload normally */ }
  return null;
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

  // Permanent duplicate guard, two layers so a second copy is impossible.
  const key = slug(job.title || "");
  const ledger = await loadLedger(cfg);

  // Layer 1, rename proof: this script already points at a video that still
  // exists on the channel. Works even if you retitled the video.
  if (key && ledger[key] && await videoExists(token, ledger[key])) {
    cfg.log("  already uploaded (matched by script), skipping: https://youtu.be/" + ledger[key]);
    return ledger[key];
  }

  // Layer 2: a video with this title (or your edited version of it) is already
  // up. Catches videos that predate the ledger. Record it so future runs match
  // by script even after you rename it.
  const already = await findExistingUpload(token, meta.snippet.title);
  if (already) {
    if (key) { ledger[key] = already; await saveLedger(cfg, ledger); }
    cfg.log("  already on YouTube, skipping the upload: https://youtu.be/" + already);
    return already;
  }

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
  if (!j || !j.id) throw new Error("upload finished but YouTube returned no video id");
  const videoId = j.id;

  // Record this script to video mapping so a later run never remakes it, even
  // after you rename the video on YouTube. Committed with the content folder.
  if (key) { ledger[key] = videoId; await saveLedger(cfg, ledger); }

  // Set the generated thumbnail as the video's custom thumbnail, if we made one.
  // Needs a channel that is allowed to set custom thumbnails; failures are non fatal.
  if (videoId && job.thumbnailFile) {
    try {
      const img = await fs.readFile(job.thumbnailFile);
      const th = await fetch("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=" + videoId, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "image/jpeg", "Content-Length": String(img.length) },
        body: img
      });
      if (th.ok) cfg.log("  custom thumbnail set");
      else cfg.log("  thumbnail not set: " + th.status + " (channel may need to be verified)");
    } catch (e) { cfg.log("  thumbnail not set: " + e.message); }
  }
  return videoId;
}
