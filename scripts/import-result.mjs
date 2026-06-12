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
    "Usage: node scripts/import-result.mjs <path-to-openclaw-result.json|qa-evidence.json>",
    "  [--resource-metrics <resource-metrics.env>]",
    "  [--spec <openclaw@spec> --version <version-or-ref> --started-at <iso> --finished-at <iso>]",
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
    if (arg === "--spec") {
      args.spec = argv[(index += 1)];
      continue;
    }
    if (arg === "--version") {
      args.version = argv[(index += 1)];
      continue;
    }
    if (arg === "--started-at") {
      args.startedAt = argv[(index += 1)];
      continue;
    }
    if (arg === "--finished-at") {
      args.finishedAt = argv[(index += 1)];
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

function safeRunLabel(input) {
  return input.replace(/[^a-zA-Z0-9.-]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function buildEvidenceRunId(startedAt, spec) {
  return [
    startedAt.replaceAll(":", "").replaceAll(".", ""),
    safeRunLabel(spec),
    "telegram",
    TELEGRAM_CHANNEL.scenario,
    "rtt",
  ].join("-");
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

function isQaEvidenceSummary(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.kind === "openclaw.qa.evidence-summary"
  );
}

function requireEvidenceArgs(args) {
  requireString(args.spec, "--spec");
  requireString(args.version, "--version");
  requireString(args.startedAt, "--started-at");
  requireString(args.finishedAt, "--finished-at");
  const startedAtMs = Date.parse(args.startedAt);
  const finishedAtMs = Date.parse(args.finishedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error("--started-at must be a parseable ISO timestamp.");
  }
  if (!Number.isFinite(finishedAtMs)) {
    throw new Error("--finished-at must be a parseable ISO timestamp.");
  }
  if (finishedAtMs < startedAtMs) {
    throw new Error("--finished-at must be at or after --started-at.");
  }
  return { finishedAtMs, startedAtMs };
}

function evidenceEntry(evidence, testId) {
  const entries = Array.isArray(evidence.entries) ? evidence.entries : [];
  const entry = entries.find((candidate) => candidate?.test?.id === testId);
  if (!entry) {
    const available = entries.map((candidate) => candidate?.test?.id).filter(Boolean).join(", ");
    throw new Error(`qa evidence missing ${testId}; available: ${available || "<none>"}`);
  }
  return entry;
}

function readTiming(entry, label) {
  const timing = entry?.result?.timing;
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) {
    throw new Error(`${label} is missing result.timing.`);
  }
  return timing;
}

function finiteTimingNumber(timing, name) {
  const value = timing[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function providerModeFromEvidence(entry) {
  const provider = entry?.execution?.provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return "unknown";
  }
  if (typeof provider.auth === "string" && provider.auth.trim()) {
    return provider.auth;
  }
  if (typeof provider.fixture === "string" && provider.fixture.trim()) {
    return provider.fixture;
  }
  return provider.live === true ? "live-frontier" : "mock-openai";
}

function statusFromEvidence(entries) {
  return entries.every((entry) => entry?.result?.status === "pass") ? "pass" : "fail";
}

function buildResultFromEvidence(evidence, args) {
  const { finishedAtMs, startedAtMs } = requireEvidenceArgs(args);
  const canary = evidenceEntry(evidence, "telegram-canary");
  const mention = evidenceEntry(evidence, TELEGRAM_CHANNEL.scenario);
  const canaryTiming = readTiming(canary, "telegram-canary");
  const mentionTiming = readTiming(mention, TELEGRAM_CHANNEL.scenario);
  const canaryMs = finiteTimingNumber(canaryTiming, "rttMs");
  const mentionReplyMs =
    finiteTimingNumber(mentionTiming, "p50Ms") ?? finiteTimingNumber(mentionTiming, "rttMs");
  const sampleCount = finiteTimingNumber(mentionTiming, "samples");
  const failedSamples = finiteTimingNumber(mentionTiming, "failedSamples");
  return {
    package: {
      spec: args.spec,
      version: args.version,
    },
    run: {
      id: buildEvidenceRunId(args.startedAt, args.spec),
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      status:
        statusFromEvidence([canary, mention]) === "pass" &&
        typeof canaryMs === "number" &&
        typeof mentionReplyMs === "number"
          ? "pass"
          : "fail",
    },
    mode: {
      providerMode: providerModeFromEvidence(mention),
      scenarios: [TELEGRAM_CHANNEL.scenario],
      source: "qa-evidence",
    },
    rtt: {
      canaryMs,
      mentionReplyMs,
      avgMs: finiteTimingNumber(mentionTiming, "avgMs"),
      p50Ms: finiteTimingNumber(mentionTiming, "p50Ms") ?? mentionReplyMs,
      p95Ms: finiteTimingNumber(mentionTiming, "p95Ms"),
      maxMs: finiteTimingNumber(mentionTiming, "maxMs"),
      failedSamples,
      ...(typeof sampleCount === "number" ? { sampleCount } : {}),
      sources: ["qa-evidence"],
    },
    samples:
      typeof sampleCount === "number"
        ? [
            {
              index: 1,
              status: mention?.result?.status === "pass" ? "pass" : "fail",
              details: `aggregate timing from qa-evidence.json (${Math.max(
                0,
                sampleCount - (failedSamples ?? 0),
              )}/${sampleCount} samples passed)`,
            },
          ]
        : undefined,
  };
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function existingRunIds() {
  const ids = await existingChannelRunIds(TELEGRAM_CHANNEL.id);
  return new Set([...ids].filter(Boolean));
}

function resourceMeasurementForResult(result) {
  return {
    kind: "process-max-rss",
    scope: "release-harness-command",
    command:
      result.mode?.source === "qa-evidence" ? "pnpm test:docker:npm-telegram-live" : "pnpm rtt",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const input = await readJson(path.resolve(args.sourcePath));
  const result = isQaEvidenceSummary(input)
    ? buildResultFromEvidence(input, args)
    : validateResult(input);
  const seen = await existingRunIds();
  if (seen.has(result.run.id)) {
    throw new Error(`Run already imported: ${result.run.id}`);
  }
  if (args.resourceMetricsPath) {
    const resourceMetrics = await readResourceMetrics(path.resolve(args.resourceMetricsPath));
    result.resources = aggregateResources([resourceMetrics], resourceMeasurementForResult(result));
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
