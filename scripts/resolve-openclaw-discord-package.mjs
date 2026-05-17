import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";

const execFileAsync = promisify(execFile);
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const DISCORD_RELEASE_MIN_VERSION = "2026.4.24";
const DISCORD_RELEASE_PROTOCOL_GAPS = new Set(["2026.4.29", "2026.5.3"]);
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

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const discordRows = releaseRows(await readDiscordRttRows());
const baselineRows = releaseRows(await readRows());
const baselineVersions = releaseVersionSet(
  baselineRows.filter((row) => compareVersions(row.package.version, DISCORD_RELEASE_MIN_VERSION) >= 0),
);
const anchor = latestReleaseVersion(discordRows) ?? latestStableVersion(baselineRows);
if (!anchor) {
  throw new Error("No measured openclaw release baseline found.");
}

const rssBackfill = process.env.INPUT_RSS_BACKFILL === "true";
const rssBackfillLimit = readPositiveIntegerEnv("INPUT_RSS_BACKFILL_LIMIT");
let queue;
if (rssBackfill) {
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
  const measured = new Set(discordRows.map((row) => `${row.package.spec}\0${row.package.version}`));
  queue = (await npmVersions())
    .filter((version) => typeof version === "string" && parseVersion(version))
    .map((version) => ({ version, spec: `openclaw@${version}`, tag: `v${version}` }))
    .filter((pkg) => compareVersions(pkg.version, DISCORD_RELEASE_MIN_VERSION) >= 0)
    .filter((pkg) => !DISCORD_RELEASE_PROTOCOL_GAPS.has(pkg.version))
    .filter((pkg) => !measured.has(`${pkg.spec}\0${pkg.version}`))
    .filter(
      (pkg) =>
        baselineVersions.has(pkg.version) || compareVersions(pkg.version, anchor) > 0,
    )
    .sort((left, right) => compareVersions(left.version, right.version));
}
const missingBaselineCount = rssBackfill ? 0 : queue.filter((pkg) => baselineVersions.has(pkg.version)).length;
const reason =
  queue.length === 0
    ? rssBackfill
      ? "no-discord-release-rss-backfill-needed"
      : "no-new-or-missing-discord-release-versions"
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
