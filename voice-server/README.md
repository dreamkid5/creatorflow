# Local voice server

A free voice that runs on your own Mac. No card, no key, nothing leaves your machine. It wraps Piper, an open voice engine. Good quality and fast, a genuine step above the browser voice, though not quite a paid premium voice.

## Setup, once

Needs Node and Python 3, which your Mac has. If not: `brew install node python`.

```
cd voice-server
bash setup.sh
```
That installs Piper and downloads the Ryan voice.

## Run it

```
node server.mjs
```
Leave it open. It listens on `http://localhost:5111`. It is free and private.

## Use it in the app

In the project root `.env`, add:
```
LOCAL_TTS_URL=http://localhost:5111
```
Restart `npm run dev`. On the Auto Video page the Premium option now uses your local voice.

## Use it in the worker for 5 a day

In `worker/.env`, add the same line:
```
LOCAL_TTS_URL=http://localhost:5111
```
Then run `npm run now` in the worker as usual. Keep this voice server running too.

## Changing the voice

Download another voice with the links printed by `setup.sh`, then set the file in your environment:
```
PIPER_MODEL=/full/path/to/en_GB-alan-medium.onnx node server.mjs
```

## Honest note

Piper is clear and natural and completely free with no card, and it is faster than the on device browser voice. It is not as lifelike as ElevenLabs or the paid tiers of Azure and Google. For a documentary channel it is a solid free choice. If you later want the top polish, connect a free tier key on Azure or Google instead.
