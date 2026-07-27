// Persistent presenter identity registry. Every accepted presenter records both
// its seed and exact image hash so later videos cannot reuse it.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

function emptyHistory() {
  return { version: 1, nextNonce: 0, records: [] };
}

export async function loadPresenterHistory(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return {
      version: 1,
      nextNonce: Math.max(0, Number(parsed.nextNonce) || 0),
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  } catch (error) {
    return emptyHistory();
  }
}

export async function savePresenterHistory(file, history) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await fs.writeFile(temp, JSON.stringify(history, null, 2) + "\n");
  await fs.rename(temp, file);
}

export async function presenterHash(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export function presenterSeed(job = {}, nonce = 0) {
  const key = String(job.title || "") + "\n" + String(job.script || "") +
    "\nunique-presenter-" + String(nonce);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 100000 + ((hash >>> 0) % 900000000);
}

export function presenterWasUsed(history, seed, hash) {
  return history.records.some((record) =>
    Number(record.seed) === Number(seed) || String(record.hash) === String(hash)
  );
}

export function recordPresenter(history, job, seed, hash, nonce) {
  const videoKey = createHash("sha256")
    .update(String(job.title || "") + "\n" + String(job.script || ""))
    .digest("hex");
  history.records.push({
    seed,
    hash,
    videoKey,
    createdAt: new Date().toISOString()
  });
  history.nextNonce = Math.max(history.nextNonce, Number(nonce) + 1);
}
