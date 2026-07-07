// Daily routine for the worker.
//   1. If input/pending.csv exists, rename it to today's date, so each day
//      has its own named batch.
//   2. Run the worker once to render and optionally upload the day's videos.
//   3. Move the finished MP4 files into a dated folder inside output.
//
// Point your cron at this file instead of watch.mjs to keep things tidy:
//   0 3 * * * cd /path/to/worker && AZURE_SPEECH_KEY=... node daily.mjs >> worker.log 2>&1

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// Load worker/.env if present, so keys live in one file.
try { process.loadEnvFile(); } catch (e) { /* no .env, that is fine */ }

const INPUT = process.env.CF_INPUT || "./input";
const OUTPUT = process.env.CF_OUTPUT || "./output";

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const log = (m) => console.log("[" + stamp() + "] " + m);

async function exists(p) { try { await fs.access(p); return true; } catch (e) { return false; } }

async function runDaily() {
  const date = today();
  await fs.mkdir(INPUT, { recursive: true });
  await fs.mkdir(OUTPUT, { recursive: true });

  // 1. auto name a pending batch to today's date
  const pending = path.join(INPUT, "pending.csv");
  if (await exists(pending)) {
    let target = path.join(INPUT, date + ".csv");
    let k = 2;
    while (await exists(target)) { target = path.join(INPUT, date + "-" + k + ".csv"); k++; }
    await fs.rename(pending, target);
    log("named today's batch " + path.basename(target));
  } else {
    log("no pending.csv, rendering any new CSV files in " + INPUT);
  }

  // 2. run the worker once, passing through all env such as the voice key
  log("rendering the day's batch");
  await new Promise((resolve) => {
    const child = spawn(process.execPath, ["watch.mjs", "--once"], { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("close", () => resolve());
    child.on("error", (e) => { log("worker error: " + e.message); resolve(); });
  });

  // 3. move the finished videos into a dated folder
  const dateDir = path.join(OUTPUT, date);
  const entries = await fs.readdir(OUTPUT, { withFileTypes: true });
  const videos = entries.filter((e) => e.isFile() && /\.(mp4|webm)$/i.test(e.name));
  if (videos.length) {
    await fs.mkdir(dateDir, { recursive: true });
    for (const v of videos) await fs.rename(path.join(OUTPUT, v.name), path.join(dateDir, v.name));
    log("moved " + videos.length + " video(s) into output/" + date);
  } else {
    log("no new videos to move");
  }
  log("done");
}

// --watch keeps running and processes new batches the moment they appear.
// Without it, the routine runs once and exits, which suits cron.
const CONTINUOUS = process.argv.includes("--watch");
const INTERVAL = Number(process.env.CF_INTERVAL || 60);

async function loop() {
  try { await runDaily(); } catch (e) { console.error(e); }
  if (CONTINUOUS) setTimeout(loop, INTERVAL * 1000);
}

if (CONTINUOUS) log("watching, checking every " + INTERVAL + "s. Drop input/pending.csv anytime.");
loop();
