import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { resolveChannelRttChannel } from "./channel-rtt-config.mjs";
import {
  compareOpenClawVersions,
  isStableOpenClawVersion,
  parseOpenClawVersion,
} from "./openclaw-version.mjs";
import { readRows } from "./read-rows.mjs";
import { channelReleaseSkipReason } from "./release-gap-reasons.mjs";

const execFileAsync = promisify(execFile);
const TELEGRAM_CHANNEL = resolveChannelRttChannel("telegram");

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

function latestMeasuredStable(rows) {
  const latestStable = rows
    .map((row) => row.package.version)
    .filter((version) => typeof version === "string" && isStableOpenClawVersion(version))
    .sort(compareOpenClawVersions)
    .at(-1);

  if (!latestStable) {
    throw new Error("No measured stable openclaw releases found.");
  }
  return latestStable;
}

function releaseRows(rows) {
  const byVersion = new Map();
  for (const row of rows) {
    if (
      typeof row.package?.spec === "string" &&
      typeof row.package?.version === "string" &&
      row.package.spec === `openclaw@${row.package.version}` &&
      parseOpenClawVersion(row.package.version)
    ) {
      byVersion.set(row.package.version, row);
    }
  }
  return [...byVersion.values()];
}

function successfulReleaseRows(rows) {
  return releaseRows(rows).filter((row) => row.run?.status === "pass");
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

function readVersionSetEnv(name) {
  const value = process.env[name];
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(/[\s,]+/u)
      .map((part) => part.trim())
      .filter(Boolean),
  );
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

function isMeasurableRelease(pkg) {
  const skipReason = channelReleaseSkipReason(TELEGRAM_CHANNEL, pkg.version);
  if (!skipReason) {
    return true;
  }
  process.stderr.write(`Skipping telegram ${pkg.spec}: ${skipReason}.\n`);
  return false;
}

const rows = await readRows();
const anchor = latestMeasuredStable(rows);
const requestedVersions = readRequestedVersionsEnv("INPUT_VERSIONS");
const rssBackfill = process.env.INPUT_RSS_BACKFILL === "true";
const rssBackfillLimit = readPositiveIntegerEnv("INPUT_RSS_BACKFILL_LIMIT");
const rssBackfillSkipVersions = readVersionSetEnv("INPUT_RSS_BACKFILL_SKIP_VERSIONS");
let queue;
if (requestedVersions.length > 0) {
  queue = requestedVersions
    .map((version) => ({ version, spec: `openclaw@${version}` }))
    .filter(isMeasurableRelease)
    .sort((left, right) => compareOpenClawVersions(left.version, right.version));
} else if (rssBackfill) {
  queue = releaseRows(rows)
    .filter((row) => row.resources?.maxRssKb?.max === undefined)
    .filter((row) => !rssBackfillSkipVersions.has(row.package.version))
    .map((row) => ({ version: row.package.version, spec: row.package.spec }))
    .sort((left, right) => compareOpenClawVersions(right.version, left.version))
    .slice(0, rssBackfillLimit);
} else {
  const measured = new Set(
    successfulReleaseRows(rows).map((row) => `${row.package.spec}\0${row.package.version}`),
  );
  queue = (await npmVersions())
    .filter((version) => typeof version === "string" && parseOpenClawVersion(version))
    .filter((version) => compareOpenClawVersions(version, anchor) > 0)
    .map((version) => ({ version, spec: `openclaw@${version}` }))
    .filter(isMeasurableRelease)
    .filter((pkg) => !measured.has(`${pkg.spec}\0${pkg.version}`))
    .sort((left, right) => compareOpenClawVersions(left.version, right.version));
}

await writeOutput({
  anchor,
  count: String(queue.length),
  specs: queue.map((pkg) => pkg.spec).join(" "),
  versions: queue.map((pkg) => pkg.version).join(" "),
  should_run: queue.length > 0 ? "true" : "false",
  rss_backfill: rssBackfill ? "true" : "false",
  reason:
    queue.length > 0
      ? requestedVersions.length > 0
        ? "requested-release-versions"
        : rssBackfill
        ? "release-rss-backfill"
        : "new-release-versions"
      : rssBackfill
        ? "no-release-rss-backfill-needed"
        : "no-new-release-versions",
});
