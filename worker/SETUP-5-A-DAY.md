# Five videos a day, on a schedule

This makes five storytime videos a day on your Mac, files them into dated
folders, and can optionally upload them to YouTube.

Every video uses the locked `en-US-AvaMultilingualNeural` female narration.
Every presenter is a white adult woman fixed on the left side. There is no voice
setting to configure and old CSV voice values are ignored.

## Part 1: prepare the worker (once)

```
brew install node ffmpeg
python3 -m pip install edge-tts pillow
cd "/Users/mac/Desktop/WEBSITE/YOUTUBE AUTOMATION TOOL/worker"
mkdir -p input output
cp .env.example .env
```

Each time you want videos, put them in `input/pending.csv`. One row per video:
`title, script, hook, style, music`. The hook is optional; when it is blank, the
thumbnail uses the opening words of the script. Start from the template:

```
cp sample-videos.csv input/pending.csv
```

## Part 2: start it now

This begins immediately and keeps running. It renders whatever is waiting, then watches for the next batch:

```
npm run now
```

It renames each batch to the date, renders every row with Ava, and files the
finished MP4s into `output/<date>`. Leave it running and drop in another
`input/pending.csv` whenever you want more.

To make one batch and stop instead, use `npm run once`.

## Part 3, optional: a fixed daily time instead

If you would rather it run at a set time than stay open, use cron. Run `crontab -e` and add one line, then save and quit:

```
0 3 * * * cd "/Users/mac/Desktop/WEBSITE/YOUTUBE AUTOMATION TOOL/worker" && caffeinate -i /usr/local/bin/node daily.mjs >> worker.log 2>&1
```

If `which node` shows a different path, use that instead of `/usr/local/bin/node`.

## Part 4, optional: upload to YouTube

Add your YouTube keys to the same cron line to upload each finished video:
```
YT_CLIENT_ID=... YT_CLIENT_SECRET=... YT_REFRESH_TOKEN=... CF_YT_PRIVACY=unlisted
```
See the main worker README for getting those keys.

## Two honest reminders

- The Mac must be awake at the scheduled time. Keep it plugged in and run `sudo pmset -c sleep 0`, or wake it just before with `sudo pmset repeat wakeorpoweron MTWRFSU 02:59:00`. A closed sleeping laptop skips the job, so an always on machine or a small cloud server is more dependable for a real daily channel.
- YouTube limits how many uploads a new channel can do per day. Five is usually fine, but if uploads fail, spread them out or grow your channel limits over time.
