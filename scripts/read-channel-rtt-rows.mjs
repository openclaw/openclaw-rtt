import fs from "node:fs/promises";
import path from "node:path";
import { CHANNEL_RTT_DATA_DIR } from "./channel-rtt-config.mjs";

export function compareChannelRttStartedAt(left, right) {
  return String(left.run.startedAt).localeCompare(String(right.run.startedAt));
}

async function readJsonl(pathname) {
  const text = await fs.readFile(pathname, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readChannelRttRows() {
  let entries = [];
  try {
    entries = await fs.readdir(CHANNEL_RTT_DATA_DIR, { withFileTypes: true });
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
    rows.push(...(await readJsonl(path.join(CHANNEL_RTT_DATA_DIR, entry.name))));
  }
  return rows.sort(compareChannelRttStartedAt);
}
