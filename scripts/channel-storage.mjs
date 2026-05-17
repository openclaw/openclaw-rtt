import fs from "node:fs/promises";
import path from "node:path";

export const CHANNEL_DATA_DIR = "data/channels";
export const CHANNEL_RUNS_DIR = "runs";

export function channelDataPath(channelId) {
  return path.join(CHANNEL_DATA_DIR, `${channelId}.jsonl`);
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

export async function readChannelRows(channelId) {
  try {
    return (await readJsonl(channelDataPath(channelId))).sort(compareStartedAt);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    rows.push(...(await readJsonl(path.join(CHANNEL_DATA_DIR, entry.name))));
  }
  return rows.sort(compareStartedAt);
}

export async function existingChannelRunIds(channelId) {
  return new Set((await readChannelRows(channelId)).map((row) => row.run?.id).filter(Boolean));
}
