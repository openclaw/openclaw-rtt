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
const SLACK_RELEASE_START = "<!-- slack-release-sweep:start -->";
const SLACK_RELEASE_END = "<!-- slack-release-sweep:end -->";
const WHATSAPP_RELEASE_START = "<!-- whatsapp-release-sweep:start -->";
const WHATSAPP_RELEASE_END = "<!-- whatsapp-release-sweep:end -->";
const MAIN_SPEC = "openclaw@main";
const MAIN_DASHBOARD_ORDER = new Map([
  ["Telegram", 0],
  ["Discord", 1],
  ["Slack", 2],
  ["WhatsApp", 3],
]);
const RELEASE_COVERAGE_CHANNELS = ["Telegram", "Discord", "Slack", "WhatsApp"];
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const RELEASE_COVERAGE_MIN_VERSION = "2026.4.24";
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
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

function resultLabel(row) {
  return row.run.status === "pass" ? "Pass" : "Fail";
}

function latestMainRow({ label, row, rssP50 = "-", rssP95 = "-" }) {
  if (!row) {
    return `| ${label} | - | - | - | - |`;
  }
  return [
    `| ${label}`,
    formatMs(row.rtt.p50Ms),
    formatMs(row.rtt.p95Ms),
    rssP50,
    `${rssP95} |`,
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

function latestPassingRow(rows) {
  return latestRow(rows.filter((row) => row.run.status === "pass"));
}

function latestDashboardRow(rows) {
  return latestPassingRow(rows) ?? latestRow(rows);
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

function channelRttRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.channel.id}\0${row.channel.scenario}\0${row.package.spec}`;
    const existing = byKey.get(key) ?? [];
    existing.push(row);
    byKey.set(key, existing);
  }
  return [...byKey.values()].map(latestDashboardRow).filter(Boolean).sort((left, right) => {
    const channelDiff = String(left.channel.label).localeCompare(String(right.channel.label));
    if (channelDiff !== 0) {
      return channelDiff;
    }
    return String(right.run.startedAt).localeCompare(String(left.run.startedAt));
  });
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
      rssP95: formatRssKb(row.resources?.maxRssKb?.p95),
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
    "| Channel | RTT p50 | RTT p95 | RSS p50 | RSS p95 |",
    "|---|---:|---:|---:|---:|",
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
    "| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 |",
    "|---|---:|---:|---:|---:|",
    ...tableRows.map(
      (row) =>
        `| \`${row.package.version}\` | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatRssKb(row.resources?.maxRssKb?.p50)} | ${formatRssKb(row.resources?.maxRssKb?.p95)} |`,
    ),
    "",
    end,
  ].join("\n");
}

function channelReleaseTableFor(channelRows, label, start, end) {
  return releaseTableFor(
    channelRows.filter((row) => row.channel.label === label),
    start,
    end,
  );
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
  const metric = formatMs(row.rtt.p50Ms);
  return row.run.status === "pass" ? metric : `${resultLabel(row)} · ${metric}`;
}

function releaseP50StdDev(rows) {
  const p50s = rows
    .map((row) => row?.rtt.p50Ms)
    .filter((value) => typeof value === "number");
  if (p50s.length < 2) {
    return "-";
  }
  const mean = p50s.reduce((sum, value) => sum + value, 0) / p50s.length;
  const variance = p50s.reduce((sum, value) => sum + (value - mean) ** 2, 0) / p50s.length;
  return formatMs(Math.sqrt(variance));
}

function releaseCoverageTableFor(telegramRows, discordRows, channelRows) {
  const rowsByChannel = new Map([
    ["Telegram", releaseRowByVersion(telegramRows)],
    ["Discord", releaseRowByVersion(discordRows)],
    ...["Slack", "WhatsApp"].map((label) => [
      label,
      releaseRowByVersion(channelRows.filter((row) => row.channel.label === label)),
    ]),
  ]);
  const versions = [
    ...new Set([...rowsByChannel.values()].flatMap((rowsByVersion) => [...rowsByVersion.keys()])),
  ]
    .filter((version) => compareVersions(version, RELEASE_COVERAGE_MIN_VERSION) >= 0)
    .filter((version) => RELEASE_COVERAGE_CHANNELS.every((label) => rowsByChannel.get(label)?.has(version)))
    .sort((left, right) => compareVersions(right, left));
  if (versions.length === 0) {
    return [
      RELEASE_COVERAGE_START,
      "",
      "No release RTT runs have been imported yet.",
      "",
      RELEASE_COVERAGE_END,
    ].join("\n");
  }
  return [
    RELEASE_COVERAGE_START,
    "",
    `Latest imported channel run: \`${latestStartedAt(
      versions.flatMap((version) => RELEASE_COVERAGE_CHANNELS.map((label) => rowsByChannel.get(label)?.get(version))),
    )}\``,
    "",
    "| Version | p50 σ | Telegram | Discord | Slack | WhatsApp |",
    "|---|---:|---:|---:|---:|---:|",
    ...versions.map((version) => {
      const channelRowsForVersion = RELEASE_COVERAGE_CHANNELS.map((label) => rowsByChannel.get(label)?.get(version));
      const cells = channelRowsForVersion.map((row) => releaseMetricCell(row, "-"));
      return `| \`${version}\` | ${releaseP50StdDev(channelRowsForVersion)} | ${cells.join(" | ")} |`;
    }),
    "",
    RELEASE_COVERAGE_END,
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
  const channelRows = await readChannelRttRows();
  const latestMain = latestDashboardRow(rows.filter((row) => row.package.spec === MAIN_SPEC));
  const latestDiscordMain = latestDashboardRow(discordRows.filter((row) => row.package.spec === MAIN_SPEC));
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
              releaseCoverageTableFor(rows, discordRows, channelRows),
            ),
            RELEASE_START,
            RELEASE_END,
            releaseTableFor(rows, RELEASE_START, RELEASE_END),
          ),
          DISCORD_RELEASE_START,
          DISCORD_RELEASE_END,
          releaseTableFor(discordRows, DISCORD_RELEASE_START, DISCORD_RELEASE_END),
        ),
        SLACK_RELEASE_START,
        SLACK_RELEASE_END,
        channelReleaseTableFor(channelRows, "Slack", SLACK_RELEASE_START, SLACK_RELEASE_END),
      );
  const nextWithWhatsAppRelease = UPDATE_LATEST_MAIN_ONLY
    ? next
    : replaceMarked(
        next,
        WHATSAPP_RELEASE_START,
        WHATSAPP_RELEASE_END,
        channelReleaseTableFor(channelRows, "WhatsApp", WHATSAPP_RELEASE_START, WHATSAPP_RELEASE_END),
      );
  await fs.writeFile(README_PATH, nextWithWhatsAppRelease);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
