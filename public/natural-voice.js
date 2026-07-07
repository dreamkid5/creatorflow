// Free, offline neural narrator (Kokoro). No API key.
// The model downloads once from an open model host, then runs on the device
// and is cached by the browser. It returns a real WAV blob, so the voice
// both plays and bakes into the exported video.

let ttsPromise = null;

export async function loadTTS(onProgress) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const mod = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js");
      const device = ("gpu" in navigator) ? "webgpu" : "wasm";
      return await mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device,
        progress_callback: (p) => {
          if (onProgress && p && p.progress != null) onProgress(Math.round(p.progress));
        }
      });
    })();
  }
  return ttsPromise;
}

// Returns a WAV Blob for the given text and voice.
export async function synthesize(text, voice, onProgress) {
  const tts = await loadTTS(onProgress);
  const audio = await tts.generate(text, { voice: voice || "af_heart" });
  return audio.toBlob();
}
