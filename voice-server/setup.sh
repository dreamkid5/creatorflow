#!/bin/bash
# One time setup for the local voice server. Free, no card, no key.
# Installs Piper (a local voice engine) and downloads a good voice.
set -e
cd "$(dirname "$0")"

echo "1. Installing Piper. This uses Python 3, which macOS already has."
python3 -m pip install --user --upgrade piper-tts || pip3 install --user --upgrade piper-tts

echo "2. Downloading a voice. Ryan, a clear US male, good for narration."
mkdir -p voices
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high"
curl -L -o voices/en_US-ryan-high.onnx "$BASE/en_US-ryan-high.onnx"
curl -L -o voices/en_US-ryan-high.onnx.json "$BASE/en_US-ryan-high.onnx.json"

echo ""
echo "Done. Start the voice server with:"
echo "   node server.mjs"
echo ""
echo "Other good voices you can download the same way, then set PIPER_MODEL to the file:"
echo "   en_GB/alan/medium/en_GB-alan-medium         a UK male"
echo "   en_US/libritts_r/medium/en_US-libritts_r-medium   a natural US voice"
echo "   en_US/amy/medium/en_US-amy-medium           a US female"
