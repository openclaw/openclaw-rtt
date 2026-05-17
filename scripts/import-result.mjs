import fs from "node:fs/promises";
import path from "node:path";
import {
  appendChannelRow,
  channelResultPath,
  channelRunsDir,
  existingChannelRunIds,
} from "./channel-storage.mjs";
import { aggregateResources, readResourceMetrics } from "./resource-metrics.mjs";

const TELEGRAM_CHANNEL = {
  id: "telegram",
  label: "Telegram",
  scenario: "telegram-mentioned-message-reply",
};

function usage() {
  return [
    "Usage: node scripts/import-result.mjs <path-to-openclaw-result.json>",
    "  [--resource-metrics <resource-metrics.env>]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!args.sourcePath && !arg.startsWith("--")) {
      args.sourcePath = arg;
      continue;
    }
    if (arg === "--resource-metrics") {
      args.resourceMetricsPath = argv[(index += 1)];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.sourcePath) {
    throw new Error(usage());
  }
  return args;
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function validateOptionalNumber(value, label) {
  if (value !== undefined) {
    requireNumber(value, label);
  }
}

function validateResult(value) {
  const result = requireObject(value, "result");
  const packageInfo = requireObject(result.package, "result.package");
  const run = requireObject(result.run, "result.run");
  const mode = requireObject(result.mode, "result.mode");
  const rtt = requireObject(result.rtt, "result.rtt");

  requireString(packageInfo.spec, "result.package.spec");
  requireString(packageInfo.version, "result.package.version");
  requireString(run.id, "result.run.id");
  requireString(run.startedAt, "result.run.startedAt");
  requireString(run.finishedAt, "result.run.finishedAt");
  requireNumber(run.durationMs, "result.run.durationMs");
  if (run.status !== "pass" && run.status !== "fail") {
    throw new Error("result.run.status must be pass or fail.");
  }
  requireString(mode.providerMode, "result.mode.providerMode");
  if (!Array.isArray(mode.scenarios)) {
    throw new Error("result.mode.scenarios must be an array.");
  }
  validateOptionalNumber(rtt.canaryMs, "result.rtt.canaryMs");
  validateOptionalNumber(rtt.mentionReplyMs, "result.rtt.mentionReplyMs");
  validateOptionalNumber(rtt.avgMs, "result.rtt.avgMs");
  validateOptionalNumber(rtt.p50Ms, "result.rtt.p50Ms");
  validateOptionalNumber(rtt.p95Ms, "result.rtt.p95Ms");
  validateOptionalNumber(rtt.maxMs, "result.rtt.maxMs");
  validateOptionalNumber(rtt.failedSamples, "result.rtt.failedSamples");
  if (rtt.warmSamples !== undefined) {
    if (!Array.isArray(rtt.warmSamples)) {
      throw new Error("result.rtt.warmSamples must be an array.");
    }
    rtt.warmSamples.forEach((sample, index) => {
      requireNumber(sample, `result.rtt.warmSamples[${index}]`);
    });
  }

  return result;
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function existingRunIds() {
  const ids = await existingChannelRunIds(TELEGRAM_CHANNEL.id);
  return new Set([...ids].filter(Boolean));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = validateResult(await readJson(path.resolve(args.sourcePath)));
  const seen = await existingRunIds();
  if (seen.has(result.run.id)) {
    throw new Error(`Run already imported: ${result.run.id}`);
  }
  if (args.resourceMetricsPath) {
    const resourceMetrics = await readResourceMetrics(path.resolve(args.resourceMetricsPath));
    result.resources = aggregateResources([resourceMetrics]);
  }
  result.channel = {
    ...TELEGRAM_CHANNEL,
  };

  const runDir = path.join(channelRunsDir(TELEGRAM_CHANNEL.id), result.run.id);
  const resultPath = channelResultPath(TELEGRAM_CHANNEL.id, result.run.id);
  result.artifacts = {
    resultPath,
  };
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

  await appendChannelRow(TELEGRAM_CHANNEL.id, result);
  process.stdout.write(`imported ${result.run.id}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
