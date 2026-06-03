import fs from "node:fs/promises";
import { listChannelRttChannels } from "./channel-rtt-config.mjs";
import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";
import { readSurfaceRttRows } from "./read-surface-rtt-rows.mjs";
import {
  channelReleaseSkipReason,
  discordReleaseGapReason,
} from "./release-gap-reasons.mjs";

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
const SURFACE_LATEST_START = "<!-- surface-latest:start -->";
const SURFACE_LATEST_END = "<!-- surface-latest:end -->";
const SURFACE_RELEASE_COVERAGE_START = "<!-- surface-release-coverage:start -->";
const SURFACE_RELEASE_COVERAGE_END = "<!-- surface-release-coverage:end -->";
const MAIN_SPEC = "openclaw@main";
const MAIN_DASHBOARD_ORDER = new Map([
  ["Telegram", 0],
  ["Discord", 1],
  ["Slack", 2],
  ["WhatsApp", 3],
]);
const RELEASE_COVERAGE_CHANNELS = ["Telegram", "Discord", "Slack", "WhatsApp"];
const SURFACE_COVERAGE_SURFACES = ["RPC", "Control UI"];
const RELEASE_COVERAGE_TARGETS = [...RELEASE_COVERAGE_CHANNELS, ...SURFACE_COVERAGE_SURFACES];
const SURFACE_DASHBOARD_ORDER = new Map([
  ["RPC", 0],
  ["Control UI", 1],
]);
const CHANNEL_CONFIG_BY_LABEL = new Map(
  listChannelRttChannels().map((channel) => [channel.label, channel]),
);
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const RELEASE_COVERAGE_MIN_VERSION = "2026.4.24";
const SURFACE_RELEASE_COVERAGE_MIN_VERSIONS = new Map([
  ["Control UI", "2026.6.1-beta.3"],
]);
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
const UPDATE_LATEST_MAIN_ONLY = process.argv.includes("--latest-main-only");

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function formatRssKb(value) {
  return typeof value === "number"
    ? `\`${Math.round(value / 1024).toLocaleString("en-US")}MB\``
    : "n/a";
}

function formatVersion(value) {
  return /^[0-9a-f]{40}$/u.test(value) ? value.slice(0, 10) : value;
}

function escapeMarkdownTableCell(value) {
  return value.replaceAll("|", "\\|");
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

function latestMainRow({ label, row, rssP50 = "n/a", rssP95 = "n/a", status = "missing" }) {
  if (!row) {
    return `| ${label} | n/a | n/a | n/a | n/a | ${status} |`;
  }
  return [
    `| ${label}`,
    formatMs(row.rtt.p50Ms),
    formatMs(row.rtt.p95Ms),
    rssP50,
    rssP95,
    `${escapeMarkdownTableCell(status)} |`,
  ].join(" | ");
}

function latestStartedAt(rows) {
  return rows
    .filter(Boolean)
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

function isSurfaceBackfillRow(row) {
  return row?.mode?.source === "channel-rtt-backfill" || row?.surface?.scenario === "channel-rtt-backfill";
}

function latestPreferredSurfaceRow(rows) {
  const nativeRows = rows.filter((row) => !isSurfaceBackfillRow(row));
  return (
    latestPassingRow(nativeRows) ??
    latestPassingRow(rows) ??
    latestRow(nativeRows) ??
    latestRow(rows)
  );
}

function hasRttMetric(row) {
  return typeof row?.rtt?.p50Ms === "number" || typeof row?.rtt?.p95Ms === "number";
}

function hasRssMetric(row) {
  return (
    typeof row?.resources?.maxRssKb?.p50 === "number" ||
    typeof row?.resources?.maxRssKb?.p95 === "number"
  );
}

function latestReleaseSummaryRow(rows) {
  const latest = latestRow(rows);
  if (!latest) {
    return undefined;
  }
  const rttRow = latestRow(rows.filter(hasRttMetric)) ?? latest;
  const rssRow = latestRow(rows.filter(hasRssMetric)) ?? latest;
  return {
    ...latest,
    rtt: rttRow.rtt,
    resources: rssRow.resources,
  };
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

function channelRttRowGroups(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.channel.id}\0${row.channel.scenario}\0${row.package.spec}`;
    const existing = byKey.get(key) ?? [];
    existing.push(row);
    byKey.set(key, existing);
  }
  return [...byKey.values()];
}

function surfaceRttRowGroups(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.surface.id}\0${row.package.spec}`;
    const existing = byKey.get(key) ?? [];
    existing.push(row);
    byKey.set(key, existing);
  }
  return [...byKey.values()];
}

function channelRttRows(rows) {
  return channelRttRowGroups(rows).map(latestDashboardRow).filter(Boolean).sort((left, right) => {
    const channelDiff = String(left.channel.label).localeCompare(String(right.channel.label));
    if (channelDiff !== 0) {
      return channelDiff;
    }
    return String(right.run.startedAt).localeCompare(String(left.run.startedAt));
  });
}

function mainEntryStatus(row, latest) {
  if (!latest) {
    return "missing: no imported run";
  }
  const latestFailed = latest.run?.status !== "pass";
  if (latestFailed && latest.run?.id !== row?.run?.id) {
    return `stale: latest failed; showing last pass (${releaseFailureReason(latest)})`;
  }
  if (row?.run?.status !== "pass") {
    return releaseFailureReason(row);
  }
  return "ok";
}

function mainSurfaceEntryStatus(row, latest) {
  const status = mainEntryStatus(row, latest);
  if (status !== "ok") {
    return status;
  }
  if (isSurfaceBackfillRow(row)) {
    return "backfill: channel RTT";
  }
  if (row?.surface?.id === "rpc") {
    return "ok: gateway RPC";
  }
  if (row?.surface?.id === "control-ui") {
    return "ok: browser/Gateway";
  }
  return status;
}

function mainDashboardEntry(label, scenario, rows) {
  const row = latestDashboardRow(rows);
  const latest = latestRow(rows);
  return {
    label,
    scenario,
    row,
    latest,
    rssP50: formatRssKb(row?.resources?.maxRssKb?.p50),
    rssP95: formatRssKb(row?.resources?.maxRssKb?.p95),
    status: mainEntryStatus(row, latest),
  };
}

function mainChannelDashboardRows(rows) {
  return channelRttRowGroups(rows)
    .filter((group) => group[0]?.package?.spec === MAIN_SPEC)
    .map((group) => mainDashboardEntry(group[0].channel.label, group[0].channel.scenario, group));
}

function mainSurfaceDashboardRows(rows) {
  return surfaceRttRowGroups(rows)
    .filter((group) => group[0]?.package?.spec === MAIN_SPEC)
    .map((group) => {
      const entry = mainDashboardEntry(group[0].surface.label, group[0].surface.scenario, group);
      const preferred = latestPreferredSurfaceRow(group);
      const latest = latestRow(group);
      return {
        ...entry,
        row: preferred,
        latest,
        rssP50: formatRssKb(preferred?.resources?.maxRssKb?.p50),
        rssP95: formatRssKb(preferred?.resources?.maxRssKb?.p95),
        status: mainSurfaceEntryStatus(preferred, latest),
      };
    })
    .sort((left, right) => {
      const leftOrder = SURFACE_DASHBOARD_ORDER.get(left.label) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = SURFACE_DASHBOARD_ORDER.get(right.label) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return String(left.label).localeCompare(String(right.label));
    });
}

function mainDashboardRows(telegramRows, discordRows, channelRows) {
  return [
    mainDashboardEntry("Telegram", "telegram-mentioned-message-reply", telegramRows),
    mainDashboardEntry("Discord", "discord-canary", discordRows),
    ...mainChannelDashboardRows(channelRows),
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

function mainTableFor(telegramRows, discordRows, channelRows) {
  const tableRows = mainDashboardRows(telegramRows, discordRows, channelRows);
  const rows = tableRows.flatMap((entry) => [entry.row, entry.latest]).filter(Boolean);
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
    "| Channel | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |",
    "|---|---:|---:|---:|---:|---|",
    ...tableRows.map((row) => latestMainRow(row)),
    "",
    LATEST_MAIN_END,
  ].join("\n");
}

function surfaceLatestTableFor(surfaceRows) {
  const tableRows = mainSurfaceDashboardRows(surfaceRows);
  const rows = tableRows.flatMap((entry) => [entry.row, entry.latest]).filter(Boolean);
  if (rows.length === 0) {
    return [
      SURFACE_LATEST_START,
      "",
      "No `openclaw@main` surface RTT run has been imported yet.",
      "",
      SURFACE_LATEST_END,
    ].join("\n");
  }
  return [
    SURFACE_LATEST_START,
    "",
    `Latest imported surface run: \`${latestStartedAt(rows)}\` · latest ${versionAndRef(latestRow(rows).package.version)}`,
    "",
    "| Surface | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |",
    "|---|---:|---:|---:|---:|---|",
    ...tableRows.map((row) => latestMainRow(row)),
    "",
    SURFACE_LATEST_END,
  ].join("\n");
}

function releaseRows(rows, specRe = RELEASE_SPEC_RE) {
  const byVersion = new Map();
  for (const row of rows) {
    if (!specRe.test(row.package.spec)) {
      continue;
    }
    const existing = byVersion.get(row.package.version) ?? [];
    existing.push(row);
    byVersion.set(row.package.version, existing);
  }
  return [...byVersion.values()]
    .map(latestReleaseSummaryRow)
    .filter(Boolean)
    .sort((left, right) => compareVersions(right.package.version, left.package.version));
}

function releaseVersionAxis(...rowGroups) {
  return [
    ...new Set(rowGroups.flatMap((rows) => releaseRows(rows).map((row) => row.package.version))),
  ]
    .filter((version) => compareVersions(version, RELEASE_COVERAGE_MIN_VERSION) >= 0)
    .sort((left, right) => compareVersions(right, left));
}

function releaseTableVersions(tableRows, versionAxis) {
  const ownVersions = tableRows.map((row) => row.package.version);
  if (!versionAxis) {
    return ownVersions;
  }
  return [
    ...new Set([
      ...versionAxis,
      ...ownVersions.filter((version) => compareVersions(version, RELEASE_COVERAGE_MIN_VERSION) < 0),
    ]),
  ].sort((left, right) => compareVersions(right, left));
}

function releaseSkipReason(label, version) {
  if (label === "Discord") {
    return discordReleaseGapReason(version);
  }
  const channel = CHANNEL_CONFIG_BY_LABEL.get(label);
  if (channel) {
    return channelReleaseSkipReason(channel, version);
  }
  const surfaceMinVersion = SURFACE_RELEASE_COVERAGE_MIN_VERSIONS.get(label);
  return surfaceMinVersion && compareVersions(version, surfaceMinVersion) < 0
    ? `surface release coverage starts at ${surfaceMinVersion}`
    : undefined;
}

function sampleFailureDetails(row) {
  return [...(row?.samples ?? []), ...(row?.discord?.samples ?? [])]
    .reverse()
    .map((sample) => sample?.details)
    .filter((details) => typeof details === "string" && !details.startsWith("reply matched in "));
}

function parsedFailureDetails(row) {
  for (const details of sampleFailureDetails(row)) {
    try {
      const parsed = JSON.parse(details);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Details are freeform text unless a channel plugin emitted structured JSON.
    }
  }
  return undefined;
}

function releaseFailureReason(row) {
  if (!row) {
    return undefined;
  }
  const details = sampleFailureDetails(row);
  if (details.some((detail) => /status 124|timed out|timeout/iu.test(detail))) {
    return "timeout";
  }
  if (details.some((detail) => /credential pool exhausted|No available credential/iu.test(detail))) {
    return "blocked: credential pool exhausted";
  }
  const parsed = parsedFailureDetails(row);
  const statusCode = parsed?.error?.output?.statusCode ?? parsed?.output?.statusCode;
  const message = parsed?.error?.output?.payload?.message ?? parsed?.output?.payload?.message;
  if (statusCode === 401) {
    return message === "Connection Failure" ? "logged out: relink required" : "auth 401";
  }
  return details[0] ? `failed: ${details[0]}` : "failed";
}

function releaseStatus(row, label, version) {
  if (!row) {
    const skipReason = releaseSkipReason(label, version);
    return skipReason ? `not supported: ${skipReason}` : "missing: no imported run";
  }
  const totalSamples = row.samples?.length ?? row.rtt?.warmSamples?.length ?? 0;
  const passedSamples = row.rtt?.warmSamples?.length ?? 0;
  if (row.run?.status === "pass") {
    return "ok";
  }
  const reason = releaseFailureReason(row);
  if (passedSamples > 0 && totalSamples > passedSamples) {
    return `partial: ${passedSamples}/${totalSamples} samples passed; ${reason}`;
  }
  return reason;
}

function releaseMatrixCell(row, label, version) {
  if (typeof row?.rtt?.p50Ms === "number") {
    return formatMs(row.rtt.p50Ms);
  }
  if (row) {
    const status = releaseStatus(row, label, version);
    if (status.startsWith("auth 401")) {
      return "auth 401";
    }
    if (status.startsWith("logged out")) {
      return "logged out";
    }
    if (status.startsWith("blocked:")) {
      return "blocked";
    }
    if (status.startsWith("timeout")) {
      return "timeout";
    }
    if (status.startsWith("partial:")) {
      return "partial";
    }
    return "fail";
  }
  return releaseSkipReason(label, version) ? "n/a" : "-";
}

function releaseTableRow(version, row, label) {
  const status = escapeMarkdownTableCell(releaseStatus(row, label, version));
  if (!row) {
    return `| \`${version}\` | - | - | - | - | ${status} |`;
  }
  return `| \`${version}\` | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatRssKb(row.resources?.maxRssKb?.p50)} | ${formatRssKb(row.resources?.maxRssKb?.p95)} | ${status} |`;
}

function releaseTableFor(rows, start, end, { label, versionAxis } = {}) {
  const tableRows = releaseRows(rows);
  const rowsByVersion = new Map(tableRows.map((row) => [row.package.version, row]));
  const versions = releaseTableVersions(tableRows, versionAxis);
  if (versions.length === 0) {
    return [start, "", "No release RTT runs have been imported yet.", "", end].join("\n");
  }
  return [
    start,
    "",
    "| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |",
    "|---|---:|---:|---:|---:|---|",
    ...versions.map((version) => releaseTableRow(version, rowsByVersion.get(version), label)),
    "",
    end,
  ].join("\n");
}

function channelReleaseTableFor(channelRows, label, start, end, options) {
  return releaseTableFor(
    channelRows.filter((row) => row.channel.label === label),
    start,
    end,
    options,
  );
}

function releaseRowByVersion(rows) {
  const byVersion = new Map();
  for (const row of releaseRows(rows)) {
    byVersion.set(row.package.version, row);
  }
  return byVersion;
}

function surfaceReleaseRowByVersion(rows) {
  const backfilledRowsByVersion = releaseRowByVersion(rows);
  const nativeRowsByVersion = releaseRowByVersion(rows.filter((row) => !isSurfaceBackfillRow(row)));
  return new Map([...backfilledRowsByVersion, ...nativeRowsByVersion]);
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

function releaseCoverageTableFor(telegramRows, discordRows, channelRows, surfaceRows) {
  const rowsByTarget = new Map([
    ["Telegram", releaseRowByVersion(telegramRows)],
    ["Discord", releaseRowByVersion(discordRows)],
    ...["Slack", "WhatsApp"].map((label) => [
      label,
      releaseRowByVersion(channelRows.filter((row) => row.channel.label === label)),
    ]),
    ...SURFACE_COVERAGE_SURFACES.map((label) => [
      label,
      surfaceReleaseRowByVersion(surfaceRows.filter((row) => row.surface.label === label)),
    ]),
  ]);
  const versions = [
    ...new Set([...rowsByTarget.values()].flatMap((rowsByVersion) => [...rowsByVersion.keys()])),
  ]
    .filter((version) => compareVersions(version, RELEASE_COVERAGE_MIN_VERSION) >= 0)
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
    `Latest imported release coverage run: \`${latestStartedAt(
      versions.flatMap((version) => RELEASE_COVERAGE_TARGETS.map((label) => rowsByTarget.get(label)?.get(version))),
    )}\``,
    "",
    "| Version | p50 σ | Telegram | Discord | Slack | WhatsApp | RPC | Control UI |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...versions.map((version) => {
      const targetRowsForVersion = RELEASE_COVERAGE_TARGETS.map((label) => rowsByTarget.get(label)?.get(version));
      const cells = targetRowsForVersion.map((row, index) =>
        releaseMatrixCell(row, RELEASE_COVERAGE_TARGETS[index], version),
      );
      return `| \`${version}\` | ${releaseP50StdDev(targetRowsForVersion)} | ${cells.join(" | ")} |`;
    }),
    "",
    RELEASE_COVERAGE_END,
  ].join("\n");
}

function surfaceReleaseCoverageTableFor(surfaceRows) {
  const rowsBySurface = new Map(
    SURFACE_COVERAGE_SURFACES.map((label) => [
      label,
      surfaceReleaseRowByVersion(surfaceRows.filter((row) => row.surface.label === label)),
    ]),
  );
  const versions = [
    ...new Set([...rowsBySurface.values()].flatMap((rowsByVersion) => [...rowsByVersion.keys()])),
  ]
    .filter((version) => compareVersions(version, RELEASE_COVERAGE_MIN_VERSION) >= 0)
    .sort((left, right) => compareVersions(right, left));
  if (versions.length === 0) {
    return [
      SURFACE_RELEASE_COVERAGE_START,
      "",
      "No release surface RTT runs have been imported yet.",
      "",
      SURFACE_RELEASE_COVERAGE_END,
    ].join("\n");
  }
  return [
    SURFACE_RELEASE_COVERAGE_START,
    "",
    `Latest imported surface run: \`${latestStartedAt(
      versions.flatMap((version) => SURFACE_COVERAGE_SURFACES.map((label) => rowsBySurface.get(label)?.get(version))),
    )}\``,
    "",
    "| Version | RPC | Control UI |",
    "|---|---:|---:|",
    ...versions.map((version) => {
      const cells = SURFACE_COVERAGE_SURFACES.map((label) =>
        releaseMatrixCell(rowsBySurface.get(label)?.get(version), label, version),
      );
      return `| \`${version}\` | ${cells.join(" | ")} |`;
    }),
    "",
    SURFACE_RELEASE_COVERAGE_END,
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

function replaceOptionalMarked(readme, start, end, replacement) {
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex === -1 && endIndex === -1) {
    return readme;
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md must contain ${start} and ${end} markers.`);
  }
  return `${readme.slice(0, startIndex)}${replacement}${readme.slice(endIndex + end.length)}`;
}

async function main() {
  const rows = await readRows();
  const discordRows = await readDiscordRttRows();
  const channelRows = await readChannelRttRows();
  const surfaceRows = await readSurfaceRttRows();
  const releaseAxis = releaseVersionAxis(rows, discordRows, channelRows);
  const mainRows = rows.filter((row) => row.package.spec === MAIN_SPEC);
  const mainDiscordRows = discordRows.filter((row) => row.package.spec === MAIN_SPEC);
  const readme = await fs.readFile(README_PATH, "utf8");
  const withLatestMain = replaceMarked(
    readme,
    LATEST_MAIN_START,
    LATEST_MAIN_END,
    mainTableFor(mainRows, mainDiscordRows, channelRows),
  );
  const withSurfaceLatest = replaceOptionalMarked(
    withLatestMain,
    SURFACE_LATEST_START,
    SURFACE_LATEST_END,
    surfaceLatestTableFor(surfaceRows),
  );
  const next = UPDATE_LATEST_MAIN_ONLY
    ? withSurfaceLatest
    : replaceMarked(
        replaceMarked(
          replaceMarked(
            replaceMarked(
              withSurfaceLatest,
              RELEASE_COVERAGE_START,
              RELEASE_COVERAGE_END,
              releaseCoverageTableFor(rows, discordRows, channelRows, surfaceRows),
            ),
            RELEASE_START,
            RELEASE_END,
            releaseTableFor(rows, RELEASE_START, RELEASE_END, {
              label: "Telegram",
              versionAxis: releaseAxis,
            }),
          ),
          DISCORD_RELEASE_START,
          DISCORD_RELEASE_END,
          releaseTableFor(discordRows, DISCORD_RELEASE_START, DISCORD_RELEASE_END, {
            label: "Discord",
            versionAxis: releaseAxis,
          }),
        ),
        SLACK_RELEASE_START,
        SLACK_RELEASE_END,
        channelReleaseTableFor(channelRows, "Slack", SLACK_RELEASE_START, SLACK_RELEASE_END, {
          label: "Slack",
          versionAxis: releaseAxis,
        }),
      );
  const nextWithWhatsAppRelease = UPDATE_LATEST_MAIN_ONLY
    ? next
    : replaceMarked(
        next,
        WHATSAPP_RELEASE_START,
        WHATSAPP_RELEASE_END,
        channelReleaseTableFor(channelRows, "WhatsApp", WHATSAPP_RELEASE_START, WHATSAPP_RELEASE_END, {
          label: "WhatsApp",
          versionAxis: releaseAxis,
        }),
      );
  const nextWithSurfaceReleases = UPDATE_LATEST_MAIN_ONLY
    ? nextWithWhatsAppRelease
    : replaceOptionalMarked(
        nextWithWhatsAppRelease,
        SURFACE_RELEASE_COVERAGE_START,
        SURFACE_RELEASE_COVERAGE_END,
        surfaceReleaseCoverageTableFor(surfaceRows),
      );
  await fs.writeFile(README_PATH, nextWithSurfaceReleases);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
