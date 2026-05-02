import fs from "node:fs/promises";
import { readRows } from "./read-rows.mjs";

const README_PATH = "README.md";
const LATEST_MAIN_START = "<!-- latest-main:start -->";
const LATEST_MAIN_END = "<!-- latest-main:end -->";
const STABLE_START = "<!-- stable-sweep:start -->";
const STABLE_END = "<!-- stable-sweep:end -->";
const STABLE_SPEC_RE = /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*$/u;

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function mainTableFor(row) {
  if (!row) {
    return [
      LATEST_MAIN_START,
      "",
      "No `openclaw@main` RTT run has been imported yet.",
      "",
      LATEST_MAIN_END,
    ].join("\n");
  }
  return [
    LATEST_MAIN_START,
    "",
    "| Ref | Result | Samples | Canary RTT | Avg | p50 | p95 | Max | Failed attempts | Started |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| \`${row.package.version}\` | ${row.run.status === "pass" ? "Pass" : "Fail"} | ${row.rtt.warmSamples?.length ?? 0} | ${formatMs(row.rtt.canaryMs)} | ${formatMs(row.rtt.avgMs)} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatMs(row.rtt.maxMs)} | ${row.rtt.failedSamples ?? 0} | \`${row.run.startedAt}\` |`,
    "",
    LATEST_MAIN_END,
  ].join("\n");
}

function stableRows(rows) {
  const byVersion = new Map();
  for (const row of rows) {
    if (!STABLE_SPEC_RE.test(row.package.spec)) {
      continue;
    }
    byVersion.set(row.package.version, row);
  }
  return [...byVersion.values()].sort((left, right) =>
    left.package.version.localeCompare(right.package.version, undefined, { numeric: true }),
  );
}

function stableTableFor(rows) {
  const tableRows = stableRows(rows);
  if (tableRows.length === 0) {
    return [STABLE_START, "", "No stable release RTT runs have been imported yet.", "", STABLE_END].join(
      "\n",
    );
  }
  return [
    STABLE_START,
    "",
    "| npm version | Result | Samples | Canary RTT | Avg | p50 | p95 | Max | Failed attempts |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...tableRows.map(
      (row) =>
        `| \`${row.package.version}\` | ${row.run.status === "pass" ? "Pass" : "Fail"} | ${row.rtt.warmSamples?.length ?? 0} | ${formatMs(row.rtt.canaryMs)} | ${formatMs(row.rtt.avgMs)} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatMs(row.rtt.maxMs)} | ${row.rtt.failedSamples ?? 0} |`,
    ),
    "",
    STABLE_END,
  ].join("\n");
}

function replaceMarked(readme, start, end, replacement) {
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md must contain ${start} and ${end} markers.`);
  }
  return `${readme.slice(0, startIndex)}${replacement}${readme.slice(endIndex + end.length)}`;
}

async function main() {
  const rows = await readRows();
  const latestMain = rows.filter((row) => row.package.spec === "openclaw@main").at(-1);
  const readme = await fs.readFile(README_PATH, "utf8");
  const next = replaceMarked(
    replaceMarked(readme, LATEST_MAIN_START, LATEST_MAIN_END, mainTableFor(latestMain)),
    STABLE_START,
    STABLE_END,
    stableTableFor(rows),
  );
  await fs.writeFile(README_PATH, next);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
