# CreatorFlow worker

A small background service that renders CreatorFlow videos with the browser closed. It watches a folder for CSV files and turns every row into a finished MP4 using ffmpeg, so it can run on a server or on a cron schedule.

This is the unattended version of the Bulk Studio Watch folder feature.

## What it does

1. Watches an input folder for CSV files
2. For each new CSV, reads every row (title, script, style, voice, music)
3. Splits each script into scenes and generates an illustration per scene
4. Optionally generates a narration voiceover when a key is set
5. Assembles a video with Ken Burns motion and crossfades, mixes narration and music
6. Saves each finished MP4 to the output folder

No browser and no headless Chrome. All rendering is done by ffmpeg.

## Requirements

* Node 18 or newer (uses the built in fetch, no npm install needed)
* ffmpeg and ffprobe on your PATH. On a Mac: `brew install ffmpeg`

## Quick start

```
cd worker
mkdir -p input output
cp sample-videos.csv input/videos.csv
node watch.mjs --once
```

The finished videos appear in `output`. Run without `--once` to keep watching:

```
node watch.mjs
```

Then drop new CSV files into `input` and they render automatically.

## The CSV format

Columns: `title, script, style, voice, music`. Only `script` is required.

```
title,script,style,voice,music
"The Story of Valerian","In ancient Rome a weary man could not sleep...",watercolor,nova,
```

* **style**: watercolor, cinematic, storybook, anime, 3d, or flat
* **voice**: alloy, echo, fable, onyx, nova, or shimmer (used when narration is on)
* **music**: a direct URL to an audio file, mixed under the narration

## Narration

Narration is off by default. Set one provider key to turn it on. The worker picks the provider from whichever key is set.

For high volume, such as several videos a day, use Azure or Google, which both have large free tiers. The card each asks for at signup is only for identity and is not charged on the free tier.

Azure, about 500 thousand characters a month free:

```
AZURE_SPEECH_KEY=your-key AZURE_SPEECH_REGION=eastus CF_AZURE_VOICE=en-US-GuyNeural node watch.mjs --once
```

Google, about a million characters a month free, with Neural2 voices:

```
GOOGLE_TTS_KEY=your-key CF_GOOGLE_VOICE=en-US-Neural2-J node watch.mjs --once
```

For top quality on fewer videos, use ElevenLabs:

```
ELEVENLABS_API_KEY=your-key CF_ELEVEN_VOICE=VR6AewLTigWG4xSOukaG node watch.mjs --once
```

An OpenAI compatible endpoint also works with `TTS_API_KEY`, tuned by `CF_TTS_URL`, `CF_TTS_MODEL`, and `CF_TTS_VOICE`.

In a CSV, the `voice` column overrides the default per row. For Google use a voice name like `en-GB-Neural2-B`, and for ElevenLabs use a voice id.

## Settings (all optional)

| Variable | Default | Meaning |
| :-- | :-- | :-- |
| `CF_INPUT` | `./input` | Folder to watch for CSV files |
| `CF_OUTPUT` | `./output` | Folder for finished videos |
| `CF_STYLE` | `watercolor` | Default art style when a row leaves it blank |
| `CF_SCENE_SECONDS` | `4` | Seconds per scene when there is no narration |
| `CF_IMAGE_BASE` | Pollinations prompt endpoint | Image model base URL |
| `CF_IMAGE_MODEL` | `flux` | Image model name |
| `CF_MUSIC` | empty | Path to a shared music file for rows without their own |
| `TTS_API_KEY` | empty | Turns narration on |
| `CF_TTS_URL` | OpenAI speech | Text to speech endpoint |
| `CF_TTS_VOICE` | `nova` | Default voice |
| `CF_INTERVAL` | `30` | Seconds between folder checks in watch mode |
| `CF_FFMPEG` / `CF_FFPROBE` | `ffmpeg` / `ffprobe` | Binary names or paths |
| `YT_CLIENT_ID` / `YT_CLIENT_SECRET` / `YT_REFRESH_TOKEN` | empty | Turn on YouTube upload |
| `CF_YT_PRIVACY` | `private` | private, unlisted, or public |
| `CF_YT_CATEGORY` | `27` | YouTube category id (27 is Education) |
| `CF_YT_TAGS` | empty | Comma separated tags |
| `CF_YT_UPLOAD` | auto | Set to `0` to keep uploads off even with keys set |

## Run with Docker (ffmpeg bundled)

The Dockerfile installs ffmpeg for you, so nothing else is needed on the host.

```
cd worker
docker build -t creatorflow-worker .
mkdir -p input output
docker run --rm -v "$PWD/input:/app/input" -v "$PWD/output:/app/output" creatorflow-worker
```

Or with compose, which reads keys from your shell or a `.env` file:

```
docker compose up --build
```

Drop CSV files into `input` and finished videos land in `output`.

## Upload to YouTube automatically

When YouTube keys are set, every finished video is uploaded straight to your channel (as private by default). To get the keys once:

1. In the Google Cloud console, enable the **YouTube Data API v3**
2. Create an **OAuth client** of type Desktop, which gives you a client id and secret
3. Do the one time OAuth consent to get a **refresh token** for the scope `https://www.googleapis.com/auth/youtube.upload` (the OAuth Playground is the quickest way)
4. Provide them to the worker:

```
YT_CLIENT_ID=... YT_CLIENT_SECRET=... YT_REFRESH_TOKEN=... \
CF_YT_PRIVACY=unlisted node watch.mjs
```

Each upload logs its link. Uploads run per video, and a failed upload never stops the rest of the batch. Note the YouTube Data API has a daily upload quota, so very large batches may need to spread across days.

## Running on a schedule with cron

Use `--once` from cron so each run processes new CSVs and exits. This example runs every 15 minutes:

```
*/15 * * * * cd /path/to/worker && TTS_API_KEY=sk-your-key /usr/local/bin/node watch.mjs --once >> worker.log 2>&1
```

The worker remembers which CSV files it has already handled, so a repeating cron never renders the same file twice.
