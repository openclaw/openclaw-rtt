import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  compareOpenClawVersions,
  isOpenClawReleaseSpec,
  isStableOpenClawVersion,
  parseOpenClawVersion,
} from "./openclaw-version.mjs";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";
import { discordReleaseGapReason } from "./release-gap-reasons.mjs";

const execFileAsync = promisify(execFile);
const DISCORD_RELEASE_MIN_VERSION = "2026.4.24";

async function npmVersions() {
  const { stdout } = await execFileAsync("npm", ["view", "openclaw", "versions", "--json"], {
    timeout: 30_000,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("npm view openclaw versions --json must return an array.");
  }
  return parsed;
}

function latestReleaseVersion(rows) {
  return rows
    .map((row) => row.package?.version)
    .filter((version) => typeof version === "string" && parseOpenClawVersion(version))
    .sort(compareOpenClawVersions)
    .at(-1);
}

function latestStableVersion(rows) {
  return rows
    .map((row) => row.package?.version)
    .filter((version) => typeof version === "string" && isStableOpenClawVersion(version))
    .sort(compareOpenClawVersions)
    .at(-1);
}

function successfulReleaseRows(rows) {
  return releaseRows(rows).filter((row) => row.run?.status === "pass");
}

function releaseVersionSet(rows) {
  return new Set(
    rows
      .map((row) => row.package?.version)
      .filter((version) => typeof version === "string" && parseOpenClawVersion(version)),
  );
}

function releaseRows(rows) {
  return rows.filter(
    (row) =>
      typeof row.package?.spec === "string" &&
      isOpenClawReleaseSpec(row.package.spec) &&
      typeof row.package?.version === "string" &&
      parseOpenClawVersion(row.package.version),
  );
}

function readPositiveIntegerEnv(name) {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function readRequestedVersionsEnv(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }
  const versions = [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
  for (const version of versions) {
    if (!parseOpenClawVersion(version)) {
      throw new Error(`${name} contains unsupported OpenClaw version: ${version}`);
    }
    if (compareOpenClawVersions(version, DISCORD_RELEASE_MIN_VERSION) < 0) {
      throw new Error(
        `${name} contains Discord release version before ${DISCORD_RELEASE_MIN_VERSION}: ${version}`,
      );
    }
    const gapReason = discordReleaseGapReason(version);
    if (gapReason) {
      throw new Error(`${name} contains a known Discord release protocol gap: ${version} (${gapReason})`);
    }
  }
  return versions;
}

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const discordRows = releaseRows(await readDiscordRttRows());
const successfulDiscordRows = successfulReleaseRows(discordRows);
const baselineRows = releaseRows(await readRows());
const successfulBaselineRows = successfulReleaseRows(baselineRows);
const baselineVersions = releaseVersionSet(
  successfulBaselineRows.filter(
    (row) => compareOpenClawVersions(row.package.version, DISCORD_RELEASE_MIN_VERSION) >= 0,
  ),
);
const anchor = latestReleaseVersion(successfulDiscordRows) ?? latestStableVersion(successfulBaselineRows);
if (!anchor) {
  throw new Error("No measured openclaw release baseline found.");
}

const requestedVersions = readRequestedVersionsEnv("INPUT_VERSIONS");
const rssBackfill = process.env.INPUT_RSS_BACKFILL === "true";
const rssBackfillLimit = readPositiveIntegerEnv("INPUT_RSS_BACKFILL_LIMIT");
let queue;
if (requestedVersions.length > 0) {
  const publishedVersions = new Set(await npmVersions());
  queue = requestedVersions
    .map((version) => {
      if (!publishedVersions.has(version)) {
        throw new Error(`Requested OpenClaw version is not published on npm: ${version}`);
      }
      return { version, spec: `openclaw@${version}`, tag: `v${version}` };
    })
    .sort((left, right) => compareOpenClawVersions(left.version, right.version));
} else if (rssBackfill) {
  queue = discordRows
    .filter((row) => row.resources?.maxRssKb?.max === undefined)
    .map((row) => ({
      version: row.package.version,
      spec: row.package.spec,
      tag: `v${row.package.version}`,
    }))
    .sort((left, right) => compareOpenClawVersions(right.version, left.version))
    .slice(0, rssBackfillLimit);
} else {
  const measured = new Set(
    successfulDiscordRows.map((row) => `${row.package.spec}\0${row.package.version}`),
  );
  queue = (await npmVersions())
    .filter((version) => typeof version === "string" && parseOpenClawVersion(version))
    .map((version) => ({ version, spec: `openclaw@${version}`, tag: `v${version}` }))
    .filter((pkg) => compareOpenClawVersions(pkg.version, DISCORD_RELEASE_MIN_VERSION) >= 0)
    .filter((pkg) => !discordReleaseGapReason(pkg.version))
    .filter((pkg) => !measured.has(`${pkg.spec}\0${pkg.version}`))
    .filter(
      (pkg) =>
        baselineVersions.has(pkg.version) ||
        compareOpenClawVersions(pkg.version, anchor) > 0,
    )
    .sort((left, right) => compareOpenClawVersions(left.version, right.version));
}
const missingBaselineCount =
  rssBackfill || requestedVersions.length > 0
    ? 0
    : queue.filter((pkg) => baselineVersions.has(pkg.version)).length;
const reason =
  queue.length === 0
    ? rssBackfill
      ? "no-discord-release-rss-backfill-needed"
      : "no-new-or-missing-discord-release-versions"
    : requestedVersions.length > 0
      ? "requested-discord-release-versions"
    : rssBackfill
      ? "discord-release-rss-backfill"
      : missingBaselineCount > 0
        ? "missing-discord-release-versions"
        : "new-discord-release-versions";

await writeOutput({
  anchor,
  count: String(queue.length),
  baseline_count: String(baselineVersions.size),
  missing_baseline_count: String(missingBaselineCount),
  specs: queue.map((pkg) => pkg.spec).join(" "),
  versions: queue.map((pkg) => pkg.version).join(" "),
  matrix: JSON.stringify(queue),
  should_run: queue.length > 0 ? "true" : "false",
  rss_backfill: rssBackfill ? "true" : "false",
  reason,
});
