import fs from "node:fs/promises";

const [videoId, thumbnailFile] = process.argv.slice(2);

if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) {
  throw new Error("a valid 11-character YouTube video ID is required");
}
if (!thumbnailFile) throw new Error("a thumbnail file is required");

const clientId = process.env.YT_CLIENT_ID || "";
const clientSecret = process.env.YT_CLIENT_SECRET || "";
const refreshToken = process.env.YT_REFRESH_TOKEN || "";
if (!clientId || !clientSecret || !refreshToken) {
  throw new Error("YouTube OAuth credentials are missing");
}

const image = await fs.readFile(thumbnailFile);
if (!image.length || image.length > 2 * 1024 * 1024) {
  throw new Error("thumbnail must be a non-empty image no larger than 2 MB");
}

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  })
});
if (!tokenResponse.ok) {
  throw new Error("YouTube token refresh failed: " + tokenResponse.status);
}
const token = (await tokenResponse.json()).access_token;
if (!token) throw new Error("YouTube token refresh returned no access token");

const response = await fetch(
  "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=" + encodeURIComponent(videoId),
  {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "image/jpeg",
      "content-length": String(image.length)
    },
    body: image
  }
);
if (!response.ok) {
  throw new Error("YouTube thumbnail replacement failed: " + response.status + " " + (await response.text()).slice(0, 200));
}

console.log("thumbnail replaced successfully: https://youtu.be/" + videoId);
