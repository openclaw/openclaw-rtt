import fs from "node:fs/promises";
import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";

const README_PATH = "README.md";
const LATEST_MAIN_START = "<!-- latest-main:start -->";
const LATEST_MAIN_END = "<!-- latest-main:end -->";
const RELEASE_START = "<!-- release-sweep:start -->";
const RELEASE_END = "<!-- release-sweep:end -->";
const RELEASE_COVERAGE_START = "<!-- release-coverage:start -->";
const RELEASE_COVERAGE_END = "<!-- release-coverage:end -->";
const DISCORD_RELEASE_START = "<!-- discord-release-sweep:start -->";
const DISCORD_RELEASE_END = "<!-- discord-release-sweep:end -->";
const CHANNEL_RTT_START = "<!-- channel-rtt:start -->";
const CHANNEL_RTT_END = "<!-- channel-rtt:end -->";
const MAIN_SPEC = "openclaw@main";
const MAIN_DASHBOARD_ORDER = new Map([
  ["Telegram", 0],
  ["Discord", 1],
  ["Slack", 2],
  ["WhatsApp", 3],
]);
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
const DISCORD_RELEASE_MIN_VERSION = "2026.4.24";
const DISCORD_RELEASE_UNSUPPORTED_VERSIONS = new Set(["2026.4.29", "2026.5.3"]);
const UPDATE_LATEST_MAIN_ONLY = process.argv.includes("--latest-main-only");

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function formatRssKb(value) {
  return typeof value === "number"
    ? `\`${Math.round(value / 1024).toLocaleString("en-US")}MB\``
    : "-";
}

function formatVersion(value) {
  return /^[0-9a-f]{40}$/u.test(value) ? value.slice(0, 10) : value;
}

function parseVersion(version) {
  const stableMatch = STABLE_VERSION_RE.exec(version);
  if (stableMatch) {
    return [...stableMatch.slice(1).map(Number), Number.MAX_SAFE_INTEGER];
  }

  const betaMatch = BETA_VERSION_RE.exec(version);
  if (betaMatch) {
    return betaMatch.slice(1).map(Number);
  }

  return undefined;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    throw new Error(`Cannot compare unsupported versions: ${left}, ${right}`);
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function isDiscordReleaseSupportedVersion(version) {
  return (
    compareVersions(version, DISCORD_RELEASE_MIN_VERSION) >= 0 &&
    !DISCORD_RELEASE_UNSUPPORTED_VERSIONS.has(version)
  );
}

function resultLabel(row) {
  return row.run.status === "pass" ? "Pass" : "Fail";
}

function sampleCount(row) {
  return row.rtt.warmSamples?.length ?? 0;
}

function latestMainRow({ label, row, rssP50 = "-", rssMax = "-" }) {
  if (!row) {
    return `| ${label} | - | - | - | - | - |`;
  }
  return [
    `| ${label}`,
    resultLabel(row),
    formatMs(row.rtt.p50Ms),
    formatMs(row.rtt.p95Ms),
    rssP50,
    `${rssMax} |`,
  ].join(" | ");
}

function latestStartedAt(rows) {
  return rows
    .map((row) => row.run.startedAt)
    .sort()
    .at(-1);
}

function latestRow(rows) {
  return [...rows].sort((left, right) => String(left.run.startedAt).localeCompare(String(right.run.startedAt))).at(-1);
}

function versionAndRef(value) {
  const formatted = formatVersion(value);
  const [version, ref] = formatted.split("+", 2);
  if (ref) {
    return `\`${version}\` / \`${ref}\``;
  }
  return `\`${formatted}\``;
}

function latestRunSummary(rows) {
  const row = latestRow(rows);
  return `Latest imported channel run: \`${row.run.startedAt}\` · latest ${versionAndRef(row.package.version)}`;
}

function mainChannelRttRows(rows) {
  return channelRttRows(rows).filter((row) => row.package.spec === MAIN_SPEC);
}

function mainDashboardRows(telegramRow, discordRow, channelRows) {
  return [
    {
      label: "Telegram",
      scenario: "telegram-mentioned-message-reply",
      row: telegramRow,
    },
    {
      label: "Discord",
      scenario: "discord-canary",
      row: discordRow,
    },
    ...mainChannelRttRows(channelRows).map((row) => ({
      label: row.channel.label,
      scenario: row.channel.scenario,
      row,
      rssP50: formatRssKb(row.resources?.maxRssKb?.p50),
      rssMax: formatRssKb(row.resources?.maxRssKb?.max),
    })),
  ].sort((left, right) => {
    const leftOrder = MAIN_DASHBOARD_ORDER.get(left.label) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = MAIN_DASHBOARD_ORDER.get(right.label) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    const labelDiff = String(left.label).localeCompare(String(right.label));
    if (labelDiff !== 0) {
      return labelDiff;
    }
    return String(left.scenario).localeCompare(String(right.scenario));
  });
}

function mainTableFor(telegramRow, discordRow, channelRows) {
  const tableRows = mainDashboardRows(telegramRow, discordRow, channelRows);
  const rows = tableRows.map((entry) => entry.row).filter(Boolean);
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
    latestRunSummary(rows),
    "",
    "| Channel | Result | RTT p50 | RTT p95 | RSS p50 | RSS max |",
    "|---|---:|---:|---:|---:|---:|",
    ...tableRows.map((row) => latestMainRow(row)),
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
  return [...byVersion.values()].sort((left, right) => compareVersions(right.package.version, left.package.version));
}

function releaseTableFor(rows, start, end) {
  const tableRows = releaseRows(rows);
  if (tableRows.length === 0) {
    return [start, "", "No release RTT runs have been imported yet.", "", end].join("\n");
  }
  return [
    start,
    "",
    "| npm version | Result | Samples | p50 | p95 | RSS p50 | RSS max |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...tableRows.map(
      (row) =>
        `| \`${row.package.version}\` | ${resultLabel(row)} | ${sampleCount(row)} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatRssKb(row.resources?.maxRssKb?.p50)} | ${formatRssKb(row.resources?.maxRssKb?.max)} |`,
    ),
    "",
    end,
  ].join("\n");
}

function releaseRowByVersion(rows) {
  const byVersion = new Map();
  for (const row of releaseRows(rows)) {
    byVersion.set(row.package.version, row);
  }
  return byVersion;
}

function releaseMetricCell(row, missingLabel = "Missing") {
  if (!row) {
    return missingLabel;
  }
  const metric = `${formatMs(row.rtt.p50Ms)} / ${formatMs(row.rtt.p95Ms)}`;
  return row.run.status === "pass" ? metric : `${resultLabel(row)} · ${metric}`;
}

function releaseCoverageTableFor(telegramRows, discordRows) {
  const telegramByVersion = releaseRowByVersion(telegramRows);
  const discordByVersion = releaseRowByVersion(discordRows);
  const versions = [...new Set([...telegramByVersion.keys(), ...discordByVersion.keys()])].sort((left, right) =>
    compareVersions(right, left),
  );
  if (versions.length === 0) {
    return [
      RELEASE_COVERAGE_START,
      "",
      "No release RTT runs have been imported yet.",
      "",
      RELEASE_COVERAGE_END,
    ].join("\n");
  }
  const missingDiscord = versions.filter(
    (version) =>
      telegramByVersion.has(version) &&
      !discordByVersion.has(version) &&
      isDiscordReleaseSupportedVersion(version),
  );
  const unsupportedDiscord = versions.filter(
    (version) =>
      telegramByVersion.has(version) &&
      !discordByVersion.has(version) &&
      !isDiscordReleaseSupportedVersion(version),
  );
  const missingSummary =
    missingDiscord.length === 0
      ? "none"
      : `${missingDiscord.length} version${missingDiscord.length === 1 ? "" : "s"} missing`;
  const unsupportedSummary =
    unsupportedDiscord.length === 0
      ? ""
      : `; ${unsupportedDiscord.length} Telegram version${unsupportedDiscord.length === 1 ? " is" : "s are"} not supported by the Discord release canary`;
  const discordGapSummary = `Discord release gap: ${missingSummary}${unsupportedSummary}.`;
  return [
    RELEASE_COVERAGE_START,
    "",
    `Latest imported channel run: \`${latestStartedAt(
      versions.flatMap((version) => [telegramByVersion.get(version), discordByVersion.get(version)]).filter(Boolean),
    )}\``,
    "",
    discordGapSummary,
    "",
    "| Version | Telegram | Discord |",
    "|---|---:|---:|",
    ...versions.map((version) => {
      const telegramRow = telegramByVersion.get(version);
      const discordRow = discordByVersion.get(version);
      const discordMissingLabel = isDiscordReleaseSupportedVersion(version) ? "Missing" : "Not supported";
      return `| \`${version}\` | ${releaseMetricCell(telegramRow)} | ${releaseMetricCell(discordRow, discordMissingLabel)} |`;
    }),
    "",
    RELEASE_COVERAGE_END,
  ].join("\n");
}

function channelRttRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(`${row.channel.id}\0${row.channel.scenario}\0${row.package.spec}`, row);
  }
  return [...byKey.values()].sort((left, right) => {
    const channelDiff = String(left.channel.label).localeCompare(String(right.channel.label));
    if (channelDiff !== 0) {
      return channelDiff;
    }
    return String(right.run.startedAt).localeCompare(String(left.run.startedAt));
  });
}

function channelRttTableFor(rows) {
  const tableRows = channelRttRows(rows);
  if (tableRows.length === 0) {
    return [CHANNEL_RTT_START, "", "No channel RTT runs have been imported yet.", "", CHANNEL_RTT_END].join("\n");
  }
  return [CHANNEL_RTT_START, "", "Merged into the Dashboard table above.", "", CHANNEL_RTT_END].join("\n");
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
  const channelRows = await readChannelRttRows();
  const latestMain = rows.filter((row) => row.package.spec === MAIN_SPEC).at(-1);
  const latestDiscordMain = discordRows
    .filter((row) => row.package.spec === MAIN_SPEC)
    .at(-1);
  const readme = await fs.readFile(README_PATH, "utf8");
  const withLatestMain = replaceMarked(
    readme,
    LATEST_MAIN_START,
    LATEST_MAIN_END,
    mainTableFor(latestMain, latestDiscordMain, channelRows),
  );
  const next = UPDATE_LATEST_MAIN_ONLY
    ? withLatestMain
    : replaceMarked(
        replaceMarked(
          replaceMarked(
            replaceMarked(
              withLatestMain,
              RELEASE_COVERAGE_START,
              RELEASE_COVERAGE_END,
              releaseCoverageTableFor(rows, discordRows),
            ),
            RELEASE_START,
            RELEASE_END,
            releaseTableFor(rows, RELEASE_START, RELEASE_END),
          ),
          DISCORD_RELEASE_START,
          DISCORD_RELEASE_END,
          releaseTableFor(discordRows, DISCORD_RELEASE_START, DISCORD_RELEASE_END),
        ),
        CHANNEL_RTT_START,
        CHANNEL_RTT_END,
        channelRttTableFor(channelRows),
      );
  await fs.writeFile(README_PATH, next);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
