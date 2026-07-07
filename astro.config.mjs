import { defineConfig } from 'astro/config';

// Load a .env file in the project root if present, so keys live in one place.
try { process.loadEnvFile(); } catch (e) { /* no .env file, that is fine */ }

// CreatorFlow YouTube automation dashboard
export default defineConfig({
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 4321
  },
  vite: {
    server: {
      proxy: {
        // Same origin proxy to a keyless AI image model.
        // Keeps generated images untainted so PNG export keeps working.
        "/ai-image": {
          target: "https://image.pollinations.ai",
          changeOrigin: true,
          followRedirects: true,
          rewrite: (path) => path.replace(/^\/ai-image/, "/prompt")
        },
        // Premium voice through a free tier key you provide. The key stays
        // server side and never reaches the browser. Pick a provider by which
        // key you set: ELEVENLABS_API_KEY, GOOGLE_TTS_KEY, or AZURE_SPEECH_KEY.
        "/premium-voice": {
          target: "https://api.elevenlabs.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/premium-voice/, "/v1/text-to-speech"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (process.env.ELEVENLABS_API_KEY) proxyReq.setHeader("xi-api-key", process.env.ELEVENLABS_API_KEY);
            });
          }
        },
        // Local voice server, free and no card, running on your machine.
        "/local-voice": {
          target: process.env.LOCAL_TTS_URL || "http://localhost:5111",
          changeOrigin: true,
          rewrite: () => "/synthesize"
        },
        // Google Cloud Text to Speech: large free tier, key injected server side.
        "/gtts": {
          target: "https://texttospeech.googleapis.com",
          changeOrigin: true,
          rewrite: () => "/v1/text:synthesize?key=" + (process.env.GOOGLE_TTS_KEY || "")
        },
        // Azure Speech: key injected server side, region from AZURE_SPEECH_REGION.
        "/azure-tts": {
          target: "https://" + (process.env.AZURE_SPEECH_REGION || "eastus") + ".tts.speech.microsoft.com",
          changeOrigin: true,
          rewrite: () => "/cognitiveservices/v1",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (process.env.AZURE_SPEECH_KEY) proxyReq.setHeader("Ocp-Apim-Subscription-Key", process.env.AZURE_SPEECH_KEY);
            });
          }
        }
      }
    }
  }
});
