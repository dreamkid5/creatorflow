# CreatorFlow worker

A small background service that renders CreatorFlow videos with the browser closed. It watches a folder for CSV files and turns every row into a finished MP4 using ffmpeg, so it can run on a server or on a cron schedule.

This is the unattended version of the Bulk Studio Watch folder feature.

## What it does

1. Watches an input folder for CSV files
2. For each new CSV, reads every row (title, script, hook, style, music)
3. Splits each script into exact narration segments and generates a matching photorealistic story image for each one
4. Generates free neural narration with exact word timings
5. Composites a consistent presenter on the left, moving story scenes on the right, and large highlighted captions
6. Creates the matching hook-text thumbnail with the same presenter on the right
7. Mixes optional music and saves a 1080p MP4

No browser and no headless Chrome. All rendering is done by ffmpeg.

## Requirements

* Node 18 or newer (uses the built in fetch, no npm install needed)
* Python 3 with `edge-tts` and `Pillow`: `python3 -m pip install edge-tts pillow`
* ffmpeg and ffprobe. Bundled Mac binaries in `worker/tools` are used automatically; Docker installs them too.

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

Columns: `title, script, hook, style, music`. Only `script` is required.

```
title,script,hook,style,music
"My Sister Sold Our House","My sister sold our house while I was caring for our mother...","My sister sold our house",story,
```

* **hook**: optional exact thumbnail copy; when blank, the opening hook is taken directly from the script
* **style**: retained for compatibility; the production renderer always uses the storytime split-screen format
* **music**: a direct URL to an audio file, mixed under the narration

## Narration

Narration is permanently locked to the selected female Ava voice:
`en-US-AvaMultilingualNeural`. It supplies exact word boundaries so the purple
caption highlight follows the spoken word.

```
python3 -m pip install edge-tts pillow
node watch.mjs --once
```

Environment variables, CSV columns, provider settings, and caller input cannot
override Ava. A legacy `voice` CSV column is accepted only so old files still
parse; its value is ignored.

The presenter is likewise locked to a white adult woman and is always composited
on the left side of the frame. Every accepted presenter seed and image hash is
saved in `output/.presenter-history.json`; duplicates are rejected and regenerated.
The exact accepted image is reused in that video's thumbnail.

## Locked captions and scene matching

The supplied reference video is the production template:

* presenter occupies 38% on the left; the story scene occupies the right
* four uppercase words per caption phrase
* Montserrat ExtraBold at 6% of frame height
* white letters, thick black outline, purple active-word box
* captions fixed at the same lower-centre position

Each right-side image is generated from the exact narration segment attached to
that scene. Segments target about 12 words, matching the short sentence-level
changes in the reference. Every scene is permanently locked to exactly 5.5
seconds. Its Ava audio and word timings are fitted to the same 5.5-second window,
so narration and highlighted captions remain synchronized without clipping.
When Claude scene direction is available it refines that same segment; otherwise
the segment itself is used as the image prompt.

## Thumbnail

Every video receives a 1280x720 thumbnail in the locked reference layout:

* clean white copy panel on the left
* large outlined two-beat kicker text in purple, teal, orange, and pink
* the exact same female presenter from the video on the right
* exactly two complementary headline beats, never a copied opening sentence

Provide an explicit `hook` CSV value when available; write its two beats on
separate lines or divide them with ` | `. Otherwise Claude extracts the story's
strongest truthful betrayal, secret, danger, or reversal. The locked validator
requires exactly two lines of 2-6 words each and 5-11 words total. Invalid or
unavailable automatic copy stops the upload instead of publishing a weak
one-sentence thumbnail.

## Settings (all optional)

| Variable | Default | Meaning |
| :-- | :-- | :-- |
| `CF_INPUT` | `./input` | Folder to watch for CSV files |
| `CF_OUTPUT` | `./output` | Folder for finished videos |
| `CF_STYLE` | `story` | Default split-screen storytime format |
| Scene duration | `5.5` seconds | Permanently locked; environment overrides are ignored |
| `CF_WIDTH` / `CF_HEIGHT` | `1920` / `1080` | Output resolution |
| Presenter panel | `38%` | Locked to the supplied reference |
| Captions | Montserrat ExtraBold, four words, `6%` height | Locked to the supplied reference |
| `CF_PRESENTER_HISTORY` | `output/.presenter-history.json` | Persistent never-repeat presenter registry |
| `CF_IMAGE_BASE` | Pollinations prompt endpoint | Image model base URL |
| `CF_IMAGE_MODEL` | `flux` | Image model name |
| `CF_MUSIC` | empty | Path to a shared music file for rows without their own |
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
*/15 * * * * cd /path/to/worker && /usr/local/bin/node watch.mjs --once >> worker.log 2>&1
```

The worker remembers which CSV files it has already handled, so a repeating cron never renders the same file twice.
