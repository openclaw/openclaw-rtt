import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.resolve("data/rtt.jsonl");

function formatMs(value) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

function compareStartedAt(a, b) {
  return String(a.run.startedAt).localeCompare(String(b.run.startedAt));
}

async function readRows() {
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

const rows = await readRows();
if (rows.length === 0) {
  process.stdout.write("No RTT rows yet.\n");
  process.exit(0);
}

const latest = rows.at(-1);
process.stdout.write(`Runs: ${rows.length}\n`);
process.stdout.write(
  `Latest: ${latest.package.spec} ${latest.package.version} ${latest.run.status} canary=${formatMs(
    latest.rtt.canaryMs,
  )} mention=${formatMs(latest.rtt.mentionReplyMs)}\n`,
);

for (const row of rows.slice(-10)) {
  process.stdout.write(
    [
      row.run.startedAt,
      row.package.spec,
      row.package.version,
      row.run.status,
      `canary=${formatMs(row.rtt.canaryMs)}`,
      `mention=${formatMs(row.rtt.mentionReplyMs)}`,
    ].join("  "),
  );
  process.stdout.write("\n");
}
