# CreatorFlow

A professional YouTube automation suite built with Astro. It gives a creator one clean workspace to plan, produce, schedule, and track videos.

## What is inside

| Page | What it does |
| :-- | :-- |
| Dashboard | Channel stats, growth chart, traffic sources, top videos, activity feed, and a publishing queue |
| Analytics | Deep metrics, views trend, best publishing days, audience age, top countries, and a per video breakdown |
| Videos | Full content library with live status filtering, a play preview for every video, and an edit dialog for title, description, tags, and visibility |
| Automations | An autopilot engine: turn triggers into actions, build your own recipes, start from templates, and watch a live run log |
| Bulk Studio | Drop in a CSV or a batch of scripts and it renders a finished illustrated video for each one, each with a free natural voiceover baked in, plus a live queue, progress, save all, a CSV template, per row voice and music columns, and a Watch folder mode that turns any new CSV into videos automatically and saves them back |
| Schedule | A working monthly upload calendar, smart timing suggestions, and automation toggles |
| Auto Video | The guided pipeline: paste a script to auto fill the scenes or write one image prompt per scene, then choose the narration (generate a free natural voice, upload your own audio, or none), add an optional title card and background music, and press Make the whole video to generate the images, narrate, add transitions, and render the finished MP4 in one click. No scene limit |
| Content Studio | Six generators that produce ideas, titles, descriptions, tags, thumbnail concepts, and script outlines |
| Video Studio | A real in browser editor: paste a script into the Story builder to fan it out into illustrated scenes automatically, generate AI scene images from prompts straight onto the timeline, turn a script into narration, mix image and video clips, trim each video clip with in and out handles, record or attach a voiceover, layer background music with volume mixing, add transitions, auto fit clips to the audio, preview on a canvas, and export a real MP4 or WebM video |
| Thumbnail Studio | A live canvas composer with a real AI image generator, gradient presets, a procedural art fallback, text overlays, and PNG export |
| Cartoon Studio | A hand drawn animated mascot that blinks, breathes, waves, and jumps, with lip sync to a voiceover you add or record, an optional second character, color and scene themes, a speech bubble, and export to a real MP4 or WebM with the audio included |
| Media Library | Drag and drop upload zones for images, audio, scripts, and video, with real previews, filtering, and a storage meter |
| Comment Inbox | An engagement queue with sentiment tags, filters, replies, and bulk actions |
| Admin Panel | Platform stats, user management, a moderation queue, feature flags, API keys, and system health |
| Guide | A built in help page with a playable, downloadable sample video and step by step instructions for making a narrated illustrated video from a script |
| Settings | Channel profile, connection status, appearance controls, and plan comparison |

## Highlights

* Modern dark dashboard with a light theme toggle that remembers your choice
* Fully responsive from wide desktop down to mobile
* Every chart is hand built as inline SVG, so nothing depends on an external service
* The Content Studio runs entirely in the browser, so it works instantly and offline
* Copy to clipboard on titles, tags, and full outputs

## Getting started

```
npm install
npm run dev
```

Then open the local address shown in the terminal.

To create a production build:

```
npm run build
npm run preview
```

## AI thumbnail generation

The Thumbnail Studio calls a keyless image model. Requests pass through a same origin dev proxy (configured in `astro.config.mjs`) so the generated image stays exportable as a PNG. This works while running `npm run dev`. To use your own provider, point the `/ai-image` proxy target at your image API.

## Voice

Image generation and video rendering are fully keyless. For narration you have several options, most keyless and one optional premium.

* **Free natural voice**: an open neural voice (Kokoro) that runs on your device in the browser. The small model downloads once, then works offline and needs no key. It plays and is baked into the exported video. Six voices, WebGPU when available.
* **Local voice server, no card**: a free voice that runs on your own Mac through the `voice-server` folder, wrapping the open Piper engine. No key and no card. Run its `setup.sh` once, start it, set `LOCAL_TTS_URL`, and both the Auto Video Premium option and the worker use it. Clear and fast, a step above the browser voice.
* **Premium voice, your free key**: for documentary quality like a polished upload, the Auto Video page has a Premium option. It supports three providers and picks the one whose key you set, server side, so the key never reaches the browser. Set one of `ELEVENLABS_API_KEY`, `GOOGLE_TTS_KEY`, or `AZURE_SPEECH_KEY` (with `AZURE_SPEECH_REGION`) before `npm run dev`, and the voice list changes to that provider automatically. ElevenLabs gives the top quality, Google and Azure give large free tiers for volume.
* **Upload your own audio** or **record a voiceover**: keyless, your own voice.
* **Browser voice**: instant, for checking timing.

### Premium voice and high volume

A free tier key means no payment, up to a monthly character limit. ElevenLabs sounds the best but its free tier is small, good for making individual videos. For high volume, such as several videos a day on a schedule, use a provider with a large free tier: **Google Cloud Text to Speech** gives about a million characters a month free with very good Neural2 voices, and **Microsoft Azure** gives about half a million. The background worker supports all three: set `GOOGLE_TTS_KEY` (best for volume) or `ELEVENLABS_API_KEY`, and it picks the provider automatically.

## Watch folder mode

The Bulk Studio can watch a real local folder. Choose a folder once, and every new CSV that lands in it is turned into videos and written to an `output` subfolder inside it, on the interval you pick. This uses the browser File System Access API, so it runs in desktop Chrome or Edge while the tab stays open.

For unattended rendering with the tab closed or on a server, use the background worker in the [`worker`](worker/README.md) folder. It watches a folder and renders every CSV row into an MP4 with ffmpeg, no browser needed, and runs continuously or once from cron. See [worker/README.md](worker/README.md) for setup.

## Data

The tool ships with realistic demo data in `src/data/demo.js`, so every page works right away. The Settings page has a Connection panel where a real YouTube account can be linked later to swap the sample numbers for live channel stats.

## Tech

* Astro for pages and components
* Plain CSS design system in `src/styles/global.css`
* Vanilla JavaScript for the interactive pieces
