# Put CreatorFlow live on Cloudflare Pages

This hosts the website and all the in-browser tools at a public web address, free.
The local voice server and the five a day render and upload engine stay on your Mac.
They are not part of the website.

## What is already prepared
- `functions/` holds serverless versions of the image and voice proxies, so image
  generation works on the live site.
- `wrangler.toml` points Cloudflare at the built site in `dist`.
- The free in-browser voice works on the live site with no setup.

## Step 1: make a free Cloudflare account
Go to https://dash.cloudflare.com/sign-up and sign up. No card needed.

## Step 2: build and deploy
In a Terminal, from the project folder, run these two lines:

```
npm run build
npx wrangler pages deploy dist --project-name creatorflow
```

The first time, wrangler opens your browser and asks you to allow access to your
Cloudflare account. Click Allow. It then uploads the site and prints your live
address, something like `https://creatorflow.pages.dev`.

## Step 3, optional: turn on the extras
In the Cloudflare dashboard, open your Pages project, then Settings, then
Environment variables, and add any of these. Redeploy after adding them.

- `CF_IMAGE_TOKEN` to unlock the sharper Flux images (free token from auth.pollinations.ai)
- `ELEVENLABS_API_KEY` for premium ElevenLabs voice
- `GOOGLE_TTS_KEY` for Google voice
- `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` for Azure voice

Do not set `LOCAL_TTS_URL` on Cloudflare. The local voice only works on your Mac.

## Updating the live site later
Run the same two commands from Step 2 again. Each deploy replaces the live site.

## Note on the automation
The website going live does not move your five a day automation to the cloud.
That engine needs ffmpeg and long render jobs, which Cloudflare Pages cannot run.
Keep using the automation on your Mac. The live site is your tool and dashboard,
reachable from anywhere.
