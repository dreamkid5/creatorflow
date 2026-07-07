# How to get each API key

You only need a **voice key** to start. YouTube keys are optional, for auto uploading. Pick one voice provider. Paste each value into your `.env` file, then you never touch it again.

Quick guide to which voice to pick:
- **ElevenLabs**: best quality, no card, but a small free amount, good for a few videos.
- **Azure**: very good, large free amount, card only to verify your identity, not charged.
- **Google**: very good, large free amount, card only to activate, not charged.

---

## 1. ElevenLabs voice key (no card)

Goes into `.env` as `ELEVENLABS_API_KEY`.

1. Go to `https://elevenlabs.io` and sign up for a free account.
2. Click your account circle at the bottom left, then **Profile and API key** (or **Settings**, then **API Keys**).
3. Press to reveal or **Create** a key, then copy it.
4. In `.env`, set `ELEVENLABS_API_KEY=` and paste the key after the equals sign.

That is all. The app already has good ElevenLabs voices built in.

---

## 2. Azure Speech key (recommended for volume)

Goes into `.env` as `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.

1. Go to `https://portal.azure.com` and create a free account. It asks for a card to confirm who you are. The free Speech tier does not charge you.
2. In the top search bar type **Speech services** and open it, then press **Create**.
3. Fill the form:
   - Subscription: your free one
   - Resource group: press **Create new**, name it anything
   - Region: choose one such as **East US**
   - Name: anything, such as creatorflow-voice
   - Pricing tier: choose **Free F0**
4. Press **Review and create**, then **Create**, and wait for it to finish.
5. Open the resource, then in the left menu open **Keys and Endpoint**.
6. Copy **KEY 1**, and note the **Location/Region**, for example `eastus`.
7. In `.env`, set `AZURE_SPEECH_KEY=` to KEY 1, and `AZURE_SPEECH_REGION=` to the region.

Voice names to try in the CSV voice column: `en-US-GuyNeural`, `en-GB-RyanNeural`, `en-US-JennyNeural`.

---

## 3. Google Cloud voice key (largest free amount)

Goes into `.env` as `GOOGLE_TTS_KEY`.

1. Go to `https://console.cloud.google.com` and sign in.
2. At the top, open the project picker and press **New project**, name it, **Create**, then select it.
3. In the search bar type **Text to Speech** and open **Cloud Text-to-Speech API**, then press **Enable**.
4. It asks you to enable billing and add a card. You are not charged while you stay under the free monthly amount, which covers many videos a day.
5. In the left menu open **APIs and Services**, then **Credentials**.
6. Press **Create credentials**, choose **API key**, and copy the key.
7. Recommended: press **Edit** on the key, and under **API restrictions** limit it to **Cloud Text-to-Speech API**, then Save.
8. In `.env`, set `GOOGLE_TTS_KEY=` and paste the key.

Voice names to try: `en-US-Neural2-J`, `en-GB-Neural2-B`, `en-US-Studio-O`.

---

## 4. YouTube upload keys (optional)

These let the worker upload finished videos to your channel by itself. You need three values: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, and `YT_REFRESH_TOKEN`. Do this once.

### Part A: turn on the API and make a client

1. Go to `https://console.cloud.google.com` and select a project (you can reuse the one from the Google voice step).
2. In the search bar type **YouTube Data API v3**, open it, and press **Enable**.
3. In the left menu open **APIs and Services**, then **OAuth consent screen**.
   - Choose **External**, press **Create**.
   - Fill the app name and your email where asked, then keep pressing **Save and continue**.
   - On the **Test users** step, press **Add users**, add your own Google address, and save.
4. Open **Credentials**, press **Create credentials**, then **OAuth client ID**.
   - Application type: **Desktop app**, name it anything, press **Create**.
   - Copy the **Client ID** and **Client secret**. These are your `YT_CLIENT_ID` and `YT_CLIENT_SECRET`.

### Part B: get the refresh token

1. Go to `https://developers.google.com/oauthplayground`.
2. Press the **gear** icon at the top right, tick **Use your own OAuth credentials**, and paste your Client ID and Client secret. Close the panel.
3. On the left, in the box that says **Input your own scopes**, paste this and press the blue button to add it:
   ```
   https://www.googleapis.com/auth/youtube.upload
   ```
4. Press **Authorize APIs**, sign in with the same Google account that owns your channel, and press **Allow**.
5. On the next screen press **Exchange authorization code for tokens**.
6. Copy the **Refresh token** value. That is your `YT_REFRESH_TOKEN`.

If Google shows a warning that the app is not verified, press **Advanced**, then continue, since it is your own app for your own account.

### Part C: put them in `.env`

```
YT_CLIENT_ID=your_client_id
YT_CLIENT_SECRET=your_client_secret
YT_REFRESH_TOKEN=your_refresh_token
CF_YT_PRIVACY=unlisted
```
Set privacy to `private`, `unlisted`, or `public`.

---

## After you fill in the keys

- App: put the voice key in the `.env` in the project root, then run `npm run dev`.
- Worker: put the keys in `worker/.env`, then in the worker folder run `npm run now`.

Your real `.env` files are ignored by git, so your keys are never committed.
