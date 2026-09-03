import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { listChannelRttChannels } from "./channel-rtt-config.mjs";
import {
  compareOpenClawVersions,
  isOpenClawReleaseSpec,
  parseOpenClawVersion,
} from "./openclaw-version.mjs";
import { OPENCLAW_QA_HARNESS_SHA } from "./openclaw-qa-harness.mjs";
import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";
import { readRows } from "./read-rows.mjs";
import { channelReleaseSkipReason } from "./release-gap-reasons.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_CHANNELS = ["slack", "whatsapp"];
const DEFAULT_VERSION_LIMIT = 4;
const CHANNEL_RELEASE_MIN_VERSION = "2026.4.24";

async function npmVersions() {
  const fixture = process.env.INPUT_AVAILABLE_VERSIONS;
  if (fixture) {
    return new Set(readList(fixture).filter((version) => parseOpenClawVersion(version)));
  }
  const { stdout } = await execFileAsync("npm", ["view", "openclaw", "versions", "--json"], {
    timeout: 30_000,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("npm view openclaw versions --json must return an array.");
  }
  return new Set(
    parsed.filter((version) => typeof version === "string" && parseOpenClawVersion(version)),
  );
}

function readList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[\s,]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readListEnv(name) {
  return readList(process.env[name]);
}

function readPositiveIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
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

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const channelConfig = new Map(listChannelRttChannels().map((channel) => [channel.id, channel]));
const requestedChannels = readListEnv("INPUT_CHANNELS");
const channelIds = requestedChannels.length === 0 ? DEFAULT_CHANNELS : requestedChannels;
for (const channelId of channelIds) {
  if (!channelConfig.has(channelId)) {
    throw new Error(`Unknown channel: ${channelId}`);
  }
}

const availableVersions = await npmVersions();
const explicitVersions = readListEnv("INPUT_VERSIONS");
const versionLimit = readPositiveIntegerEnv("INPUT_VERSION_LIMIT", DEFAULT_VERSION_LIMIT);
const channelRows = releaseRows(await readChannelRttRows());
const baselineVersions = new Set(
  releaseRows(await readRows())
    .filter((row) => row.run?.status === "pass")
    .map((row) => row.package.version),
);
const measured = new Set(
  channelRows
    .filter((row) => row.run?.status === "pass")
    .map(
      (row) => `${row.channel?.id}\0${row.package?.spec}\0${row.package?.version}`,
    ),
);
const attempted = new Set(
  channelRows.map(
    (row) => `${row.channel?.id}\0${row.package?.spec}\0${row.package?.version}`,
  ),
);

const queue = [];
for (const channelId of channelIds) {
  const channel = channelConfig.get(channelId);
  const measuredVersions = channelRows
    .filter((row) => row.channel?.id === channelId)
    .filter((row) => row.run?.status === "pass")
    .map((row) => row.package.version)
    .filter((version) => parseOpenClawVersion(version));
  const latestMeasured = measuredVersions.sort(compareOpenClawVersions).at(-1);
  const versions =
    explicitVersions.length > 0
      ? explicitVersions
      : [...availableVersions]
          .filter(
            (version) =>
              baselineVersions.has(version) ||
              !latestMeasured ||
              compareOpenClawVersions(version, latestMeasured) > 0,
          )
          .filter(
            (version) =>
              compareOpenClawVersions(version, CHANNEL_RELEASE_MIN_VERSION) >= 0 &&
              !measured.has(`${channelId}\0openclaw@${version}\0${version}`) &&
              !channelReleaseSkipReason(channel, version),
          )
          .sort((left, right) => {
            const leftAttempted = attempted.has(
              `${channelId}\0openclaw@${left}\0${left}`,
            );
            const rightAttempted = attempted.has(
              `${channelId}\0openclaw@${right}\0${right}`,
            );
            const attemptDiff = Number(leftAttempted) - Number(rightAttempted);
            return attemptDiff || compareOpenClawVersions(left, right);
          })
          .slice(0, versionLimit);

  for (const version of versions) {
    if (!parseOpenClawVersion(version)) {
      throw new Error(`Unsupported version: ${version}`);
    }
    if (!availableVersions.has(version)) {
      throw new Error(`openclaw@${version} was not found on npm.`);
    }
    const spec = `openclaw@${version}`;
    const skipReason = channelReleaseSkipReason(channel, version);
    if (skipReason) {
      process.stderr.write(`Skipping ${channelId} ${spec}: ${skipReason}.\n`);
      continue;
    }
    const alreadyMeasured = measured.has(`${channelId}\0${spec}\0${version}`);
    if (alreadyMeasured && explicitVersions.length === 0) {
      continue;
    }
    queue.push({
      channel: channelId,
      label: channel.label,
      scenario: channel.defaultScenario,
      summary: "qa-evidence.json",
      observed: `${channel.command}-qa-observed-messages.json`,
      qa_ref: OPENCLAW_QA_HARNESS_SHA,
      spec,
      version,
      tag: `v${version}`,
    });
  }
}

queue.sort((left, right) => {
  if (explicitVersions.length === 0) {
    const leftAttempted = attempted.has(
      `${left.channel}\0${left.spec}\0${left.version}`,
    );
    const rightAttempted = attempted.has(
      `${right.channel}\0${right.spec}\0${right.version}`,
    );
    const attemptDiff = Number(leftAttempted) - Number(rightAttempted);
    if (attemptDiff !== 0) {
      return attemptDiff;
    }
  }
  const versionDiff = compareOpenClawVersions(left.version, right.version);
  if (versionDiff !== 0) {
    return versionDiff;
  }
  return left.channel.localeCompare(right.channel);
});

const unattemptedQueue =
  explicitVersions.length === 0
    ? queue.filter(
        (pkg) => !attempted.has(`${pkg.channel}\0${pkg.spec}\0${pkg.version}`),
      )
    : [];
// Publish newly discovered coverage before retrying failed rows, since the
// report commit waits for every matrix job to finish.
const runnableQueue = unattemptedQueue.length > 0 ? unattemptedQueue : queue;

await writeOutput({
  count: String(runnableQueue.length),
  matrix: JSON.stringify(runnableQueue),
  should_run: runnableQueue.length > 0 ? "true" : "false",
  reason:
    runnableQueue.length === 0
      ? "no-missing-channel-release-versions"
      : explicitVersions.length > 0
        ? "explicit-channel-release-versions"
        : "missing-channel-release-versions",
  versions: [...new Set(runnableQueue.map((pkg) => pkg.version))].join(" "),
  channels: [...new Set(runnableQueue.map((pkg) => pkg.channel))].join(" "),
});
