// Local no card voice server. It wraps Piper, a free open voice engine that
// runs on your own machine. No key, no card, nothing leaves your Mac.
//
//   node server.mjs
//
// The app and the worker call this at http://localhost:5111.
// Run setup.sh once first to install Piper and download a voice.

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5111);
// How to invoke Piper. Default uses the Python package: python3 -m piper
const PIPER_CMD = process.env.PIPER_CMD || "python3";
const PIPER_PRE = (process.env.PIPER_PRE || "-m piper").split(" ").filter(Boolean);
const MODEL = process.env.PIPER_MODEL || path.join(HERE, "voices", "en_US-ryan-high.onnx");
const OUT_FLAG = process.env.PIPER_OUT_FLAG || "-f";

let counter = 0;

function synth(text) {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), "piper_" + Date.now() + "_" + (counter++) + ".wav");
    const args = [...PIPER_PRE, "-m", MODEL, OUT_FLAG, out];
    const p = spawn(PIPER_CMD, args);
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", (e) => reject(new Error("could not run Piper (" + PIPER_CMD + "). Run setup.sh first. " + e.message)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("Piper failed. " + err.slice(-400)));
      fs.readFile(out, (e, buf) => { fs.unlink(out, () => {}); if (e) reject(e); else resolve(buf); });
    });
    p.stdin.write(text);
    p.stdin.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Headers": "Content-Type" }); res.end(); return; }
  if (req.method === "GET") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Local voice server is running. POST text or JSON to synthesize."); return; }
  if (req.method !== "POST") { res.writeHead(405); res.end("POST only"); return; }
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", async () => {
    let text = body;
    try { const j = JSON.parse(body); if (j && (j.text || j.input)) text = j.text || j.input; } catch (e) { /* plain text body */ }
    text = (text || "").toString().trim();
    if (!text) { res.writeHead(400); res.end("no text"); return; }
    try {
      const wav = await synth(text);
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(wav);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(e.message);
    }
  });
});

server.listen(PORT, () => {
  console.log("Local voice server on http://localhost:" + PORT);
  console.log("model: " + MODEL);
  console.log("Point the app and worker at it. It is free, no key, no card.");
});
