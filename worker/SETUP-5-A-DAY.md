# Five videos a day, on a schedule

This makes 5 narrated videos a day on your Mac, on a schedule, tidied into dated folders, and optionally uploaded to YouTube. Set up once, about ten minutes.

## An honest note on the card question

There is no mainstream premium voice that gives both no card at all and enough free volume for 5 videos a day. The real choices:

- **Azure Speech**: about 500 thousand characters a month free, very good voices. Creating the Azure account asks for a card to verify who you are, but the free tier does not charge you. So a card sits on file, unused.
- **Google Cloud Text to Speech**: about a million characters a month free, also asks for a card to activate, also does not charge within the free tier.
- **ElevenLabs**: the best quality and needs no card, but only about ten thousand characters a month, which is a few videos, not five a day.
- **Truly no card and free**: the on device voice already in the app (keyless, lower quality), or a local premium voice server on your Mac (free, no card, better quality, but a heavier one time install).

This guide uses **Azure** because the card is only for verification and you are not billed on the free tier. If you want zero card on file, tell me and I will set up the local voice server instead.

## Part 1: get the free Azure voice key

1. Go to `https://portal.azure.com` and create a free account. It asks for a card to verify identity. The free Speech tier does not charge you.
2. In the top search bar type **Speech services** and open it, then **Create**.
3. Pick your subscription, create a resource group, choose a region such as **East US**, name the resource, and for pricing tier choose **Free F0**. Press **Review and create**, then **Create**.
4. Open the resource, go to **Keys and Endpoint**, and copy **KEY 1** and the **Location/Region** (for example `eastus`).

That key and region are your voice.

## Part 2: prepare the worker (once)

```
brew install node ffmpeg
cd "/Users/mac/Desktop/WEBSITE/YOUTUBE AUTOMATION TOOL/worker"
mkdir -p input output
cp .env.example .env
```
Open `.env`, paste your Azure key into `AZURE_SPEECH_KEY`, and set `AZURE_SPEECH_REGION` to your region such as `eastus`. Now you never type the key again, the worker reads this file.

Each time you want videos, put them in one file named exactly `input/pending.csv`. One row per video: `title, script, style, voice, music`. For an Azure voice, use a name in the voice column such as `en-US-GuyNeural` (US male), `en-GB-RyanNeural` (UK male), or `en-US-JennyNeural` (US female). Start from the template:
```
cp sample-videos.csv input/pending.csv
```

## Part 3: start it now

This begins immediately and keeps running. It renders whatever is waiting, then watches for the next batch:
```
npm run now
```
It renames each batch to the date, renders every row with the premium voice, and files the finished MP4s into `output/<date>`. Leave it running and drop a new `input/pending.csv` whenever you want more, they render right away, no schedule.

To make one batch and stop instead, use `npm run once`.

## Part 4, optional: a fixed daily time instead

If you would rather it run at a set time than stay open, use cron. Run `crontab -e` and add one line, then save and quit:
```
0 3 * * * cd "/Users/mac/Desktop/WEBSITE/YOUTUBE AUTOMATION TOOL/worker" && caffeinate -i /usr/local/bin/node daily.mjs >> worker.log 2>&1
```
The key comes from your `.env`, so it is not on this line. If `which node` shows a different path, use that instead of `/usr/local/bin/node`.

## Part 5, optional: upload to YouTube

Add your YouTube keys to the same cron line to upload each finished video:
```
YT_CLIENT_ID=... YT_CLIENT_SECRET=... YT_REFRESH_TOKEN=... CF_YT_PRIVACY=unlisted
```
See the main worker README for getting those keys.

## Two honest reminders

- The Mac must be awake at the scheduled time. Keep it plugged in and run `sudo pmset -c sleep 0`, or wake it just before with `sudo pmset repeat wakeorpoweron MTWRFSU 02:59:00`. A closed sleeping laptop skips the job, so an always on machine or a small cloud server is more dependable for a real daily channel.
- YouTube limits how many uploads a new channel can do per day. Five is usually fine, but if uploads fail, spread them out or grow your channel limits over time.
