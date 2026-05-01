import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.resolve("data/rtt.jsonl");

export function compareStartedAt(left, right) {
  return String(left.run.startedAt).localeCompare(String(right.run.startedAt));
}

export async function readRows() {
  try {
    const text = await fs.readFile(DATA_PATH, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort(compareStartedAt);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
