import fs from "node:fs/promises";
import path from "node:path";

export const CHANNEL_DATA_DIR = "data/channels";
export const CHANNEL_RUNS_DIR = "runs";

export function channelDataDir(channelId) {
  return path.join(CHANNEL_DATA_DIR, channelId);
}

export function channelVersionKey(version) {
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("channel data version key must be a non-empty string.");
  }
  return version.replace(/[^a-zA-Z0-9.+_-]+/gu, "_").replace(/^_+|_+$/gu, "");
}

export function channelDataPath(channelId, version) {
  return path.join(channelDataDir(channelId), `${channelVersionKey(version)}.jsonl`);
}

export function channelRunsDir(channelId) {
  return path.join(CHANNEL_RUNS_DIR, channelId);
}

export function channelResultPath(channelId, runId) {
  return path.join(channelRunsDir(channelId), runId, "result.json");
}

export function compareStartedAt(left, right) {
  return String(left.run.startedAt).localeCompare(String(right.run.startedAt));
}

export async function readJsonl(pathname) {
  const text = await fs.readFile(pathname, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

export async function appendJsonl(pathname, row) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.appendFile(pathname, `${JSON.stringify(row)}\n`);
}

export async function appendChannelRow(channelId, row) {
  await appendJsonl(channelDataPath(channelId, row.package?.version), row);
}

async function readChannelFiles(channelId) {
  const files = [];
  const legacyPath = path.join(CHANNEL_DATA_DIR, `${channelId}.jsonl`);
  try {
    await fs.access(legacyPath);
    files.push(legacyPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  let entries = [];
  try {
    entries = await fs.readdir(channelDataDir(channelId), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path.join(channelDataDir(channelId), entry.name));
    }
  }
  return files.sort();
}

export async function readChannelRows(channelId) {
  const rows = [];
  for (const file of await readChannelFiles(channelId)) {
    rows.push(...(await readJsonl(file)));
  }
  return rows.sort(compareStartedAt);
}

export async function readAllChannelRows() {
  let entries = [];
  try {
    entries = await fs.readdir(CHANNEL_DATA_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const rows = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      rows.push(...(await readJsonl(path.join(CHANNEL_DATA_DIR, entry.name))));
    }
    if (entry.isDirectory()) {
      const channelId = entry.name;
      rows.push(...(await readChannelRows(channelId)));
    }
  }
  return rows.sort(compareStartedAt);
}

export async function existingChannelRunIds(channelId) {
  return new Set((await readChannelRows(channelId)).map((row) => row.run?.id).filter(Boolean));
}
