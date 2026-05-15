import fs from "node:fs/promises";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";

const README_PATH = "README.md";
const LATEST_MAIN_START = "<!-- latest-main:start -->";
const LATEST_MAIN_END = "<!-- latest-main:end -->";
const RELEASE_START = "<!-- release-sweep:start -->";
const RELEASE_END = "<!-- release-sweep:end -->";
const DISCORD_RELEASE_START = "<!-- discord-release-sweep:start -->";
const DISCORD_RELEASE_END = "<!-- discord-release-sweep:end -->";
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const UPDATE_LATEST_MAIN_ONLY = process.argv.includes("--latest-main-only");

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function formatVersion(value) {
  return /^[0-9a-f]{40}$/u.test(value) ? value.slice(0, 10) : value;
}

function resultLabel(row) {
  return row.run.status === "pass" ? "Pass" : "Fail";
}

function sampleCount(row) {
  return row.rtt.warmSamples?.length ?? 0;
}

function latestMainRow(label, row) {
  if (!row) {
    return `| ${label} | - | - | - | - | - | - |`;
  }
  return [
    `| ${label}`,
    `\`${formatVersion(row.package.version)}\``,
    resultLabel(row),
    sampleCount(row),
    formatMs(row.rtt.p50Ms),
    formatMs(row.rtt.p95Ms),
    `\`${row.run.startedAt}\` |`,
  ].join(" | ");
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
    `Latest imported main run: \`${latestStartedAt(rows)}\``,
    "",
    "| Transport | Version/ref | Result | Samples | p50 | p95 | Updated |",
    "|---|---:|---:|---:|---:|---:|---:|",
    latestMainRow("Telegram", telegramRow),
    latestMainRow("Discord", discordRow),
    "",
    LATEST_MAIN_END,
  ].join("\n");
}

function releaseRows(rows, specRe = RELEASE_SPEC_RE) {
  const byVersion = new Map();
  for (const row of rows) {
    if (!specRe.test(row.package.spec)) {
      continue;
    }
    byVersion.set(row.package.version, row);
  }
  return [...byVersion.values()].sort((left, right) =>
    right.package.version.localeCompare(left.package.version, undefined, { numeric: true }),
  );
}

function releaseTableFor(rows, start, end) {
  const tableRows = releaseRows(rows);
  if (tableRows.length === 0) {
    return [start, "", "No release RTT runs have been imported yet.", "", end].join("\n");
  }
  return [
    start,
    "",
    "| npm version | Result | Samples | p50 | p95 | Updated |",
    "|---|---:|---:|---:|---:|---:|",
    ...tableRows.map(
      (row) =>
        `| \`${row.package.version}\` | ${resultLabel(row)} | ${sampleCount(row)} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | \`${row.run.startedAt}\` |`,
    ),
    "",
    end,
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
    : replaceMarked(
        replaceMarked(
          withLatestMain,
          RELEASE_START,
          RELEASE_END,
          releaseTableFor(rows, RELEASE_START, RELEASE_END),
        ),
        DISCORD_RELEASE_START,
        DISCORD_RELEASE_END,
        releaseTableFor(discordRows, DISCORD_RELEASE_START, DISCORD_RELEASE_END),
      );
  await fs.writeFile(README_PATH, next);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
