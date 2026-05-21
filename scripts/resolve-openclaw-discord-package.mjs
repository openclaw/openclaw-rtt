import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";
import { discordReleaseGapReason } from "./release-gap-reasons.mjs";

const execFileAsync = promisify(execFile);
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const DISCORD_RELEASE_MIN_VERSION = "2026.4.24";
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
    .filter((version) => typeof version === "string" && parseVersion(version))
    .sort(compareVersions)
    .at(-1);
}

function latestStableVersion(rows) {
  return rows
    .map((row) => row.package?.version)
    .filter((version) => typeof version === "string" && STABLE_VERSION_RE.test(version))
    .sort(compareVersions)
    .at(-1);
}

function successfulReleaseRows(rows) {
  return releaseRows(rows).filter((row) => row.run?.status === "pass");
}

function releaseVersionSet(rows) {
  return new Set(
    rows
      .map((row) => row.package?.version)
      .filter((version) => typeof version === "string" && parseVersion(version)),
  );
}

function releaseRows(rows) {
  return rows.filter(
    (row) =>
      typeof row.package?.spec === "string" &&
      RELEASE_SPEC_RE.test(row.package.spec) &&
      typeof row.package?.version === "string" &&
      parseVersion(row.package.version),
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
    if (!parseVersion(version)) {
      throw new Error(`${name} contains unsupported OpenClaw version: ${version}`);
    }
    if (compareVersions(version, DISCORD_RELEASE_MIN_VERSION) < 0) {
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
    (row) => compareVersions(row.package.version, DISCORD_RELEASE_MIN_VERSION) >= 0,
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
    .sort((left, right) => compareVersions(left.version, right.version));
} else if (rssBackfill) {
  queue = discordRows
    .filter((row) => row.resources?.maxRssKb?.max === undefined)
    .map((row) => ({
      version: row.package.version,
      spec: row.package.spec,
      tag: `v${row.package.version}`,
    }))
    .sort((left, right) => compareVersions(right.version, left.version))
    .slice(0, rssBackfillLimit);
} else {
  const measured = new Set(
    discordRows.map((row) => `${row.package.spec}\0${row.package.version}`),
  );
  queue = (await npmVersions())
    .filter((version) => typeof version === "string" && parseVersion(version))
    .map((version) => ({ version, spec: `openclaw@${version}`, tag: `v${version}` }))
    .filter((pkg) => compareVersions(pkg.version, DISCORD_RELEASE_MIN_VERSION) >= 0)
    .filter((pkg) => !discordReleaseGapReason(pkg.version))
    .filter((pkg) => !measured.has(`${pkg.spec}\0${pkg.version}`))
    .filter(
      (pkg) =>
        baselineVersions.has(pkg.version) || compareVersions(pkg.version, anchor) > 0,
    )
    .sort((left, right) => compareVersions(left.version, right.version));
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
