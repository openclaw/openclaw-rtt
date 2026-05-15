import fs from "node:fs/promises";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";

const README_PATH = "README.md";
const LATEST_MAIN_START = "<!-- latest-main:start -->";
const LATEST_MAIN_END = "<!-- latest-main:end -->";
const RELEASE_START = "<!-- release-sweep:start -->";
const RELEASE_END = "<!-- release-sweep:end -->";
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const UPDATE_LATEST_MAIN_ONLY = process.argv.includes("--latest-main-only");

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function rttCell(row) {
  if (!row) {
    return "-";
  }
  return `\`${row.package.version}\` ${row.run.status === "pass" ? "Pass" : "Fail"} ${formatMs(row.rtt.p50Ms)}/${formatMs(row.rtt.p95Ms)}`;
}

function latestStartedAt(rows) {
  return rows
    .map((row) => row.run.startedAt)
    .sort()
    .at(-1);
}

function mainTableFor(telegramRow, discordRow) {
  const rows = [telegramRow, discordRow].filter(Boolean);
  if (rows.length === 0) {
    return [
      LATEST_MAIN_START,
      "",
      "No `openclaw@main` run has been imported yet.",
      "",
      LATEST_MAIN_END,
    ].join("\n");
  }
  return [
    LATEST_MAIN_START,
    "",
    "| Target | Telegram p50/p95 | Discord p50/p95 | Updated |",
    "|---|---:|---:|---:|",
    `| \`openclaw@main\` | ${rttCell(telegramRow)} | ${rttCell(discordRow)} | \`${latestStartedAt(rows)}\` |`,
    "",
    LATEST_MAIN_END,
  ].join("\n");
}

function releaseRows(rows) {
  const byVersion = new Map();
  for (const row of rows) {
    if (!RELEASE_SPEC_RE.test(row.package.spec)) {
      continue;
    }
    byVersion.set(row.package.version, row);
  }
  return [...byVersion.values()].sort((left, right) =>
    right.package.version.localeCompare(left.package.version, undefined, { numeric: true }),
  );
}

function releaseTableFor(rows) {
  const tableRows = releaseRows(rows);
  if (tableRows.length === 0) {
    return [RELEASE_START, "", "No release RTT runs have been imported yet.", "", RELEASE_END].join("\n");
  }
  return [
    RELEASE_START,
    "",
    "| npm version | Result | Samples | p50 | p95 |",
    "|---|---:|---:|---:|---:|",
    ...tableRows.map(
      (row) =>
        `| \`${row.package.version}\` | ${row.run.status === "pass" ? "Pass" : "Fail"} | ${row.rtt.warmSamples?.length ?? 0} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} |`,
    ),
    "",
    RELEASE_END,
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
  const discordRows = await readDiscordRttRows();
  const latestMain = rows.filter((row) => row.package.spec === "openclaw@main").at(-1);
  const latestDiscordMain = discordRows
    .filter((row) => row.package.spec === "openclaw@main")
    .at(-1);
  const readme = await fs.readFile(README_PATH, "utf8");
  const withLatestMain = replaceMarked(
    readme,
    LATEST_MAIN_START,
    LATEST_MAIN_END,
    mainTableFor(latestMain, latestDiscordMain),
  );
  const next = UPDATE_LATEST_MAIN_ONLY
    ? withLatestMain
    : replaceMarked(withLatestMain, RELEASE_START, RELEASE_END, releaseTableFor(rows));
  await fs.writeFile(README_PATH, next);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
