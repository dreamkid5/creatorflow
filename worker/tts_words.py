#!/usr/bin/env python3
"""
Free Edge TTS narration with word-level timings.

Usage:
  python3 tts_words.py <text_file> <voice> <out_mp3> <out_words_json> [rate] [pitch]
"""
import sys
import json
import asyncio

try:
    import edge_tts
except ImportError:
    sys.exit("edge-tts not installed. Run: pip install edge-tts")


async def main():
    text = open(sys.argv[1], encoding="utf-8").read()
    voice = sys.argv[2]
    out_mp3 = sys.argv[3]
    out_words = sys.argv[4]
    rate = sys.argv[5] if len(sys.argv) > 5 else "+0%"
    pitch = sys.argv[6] if len(sys.argv) > 6 else "+0Hz"

    speaker = edge_tts.Communicate(
        text, voice, rate=rate, pitch=pitch, boundary="WordBoundary"
    )
    words = []
    with open(out_mp3, "wb") as audio:
        async for chunk in speaker.stream():
            kind = chunk.get("type")
            if kind == "audio":
                audio.write(chunk["data"])
            elif kind == "WordBoundary":
                words.append(
                    {
                        "w": chunk["text"],
                        "t": chunk["offset"] / 1e7,
                        "d": chunk["duration"] / 1e7,
                    }
                )
    with open(out_words, "w", encoding="utf-8") as output:
        json.dump(words, output)


asyncio.run(main())
