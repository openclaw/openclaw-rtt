import fs from "node:fs/promises";
import path from "node:path";
import {
  appendChannelRow,
  channelResultPath,
  channelRunsDir,
  existingChannelRunIds,
} from "./channel-storage.mjs";
import { aggregateResources, readResourceMetrics } from "./resource-metrics.mjs";

const DISCORD_CHANNEL = {
  id: "discord",
  label: "Discord",
  scenario: "discord-canary",
};

function usage() {
  return [
    "Usage: node scripts/import-discord-rtt.mjs <sample-paths.tsv>",
    "  --spec <openclaw@spec>",
    "  --version <version-or-ref>",
    "  [--provider-mode <mock-openai|live-frontier>]",
    "  [--require-pass]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { providerMode: "mock-openai" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!args.samplesPath && !arg.startsWith("--")) {
      args.samplesPath = arg;
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
    if (arg === "--provider-mode") {
      args.providerMode = argv[(index += 1)];
      continue;
    }
    if (arg === "--require-pass") {
      args.requirePass = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.samplesPath || !args.spec || !args.version) {
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

function validateSummary(value) {
  const summary = requireObject(value, "summary");
  const counts = requireObject(summary.counts, "summary.counts");
  requireString(summary.startedAt, "summary.startedAt");
  requireString(summary.finishedAt, "summary.finishedAt");
  requireNumber(counts.total, "summary.counts.total");
  requireNumber(counts.passed, "summary.counts.passed");
  requireNumber(counts.failed, "summary.counts.failed");
  if (!Array.isArray(summary.scenarios)) {
    throw new Error("summary.scenarios must be an array.");
  }
  return summary;
}

function normalizeEvidenceSummary(value) {
  if (value?.kind !== "openclaw.qa.evidence-summary") {
    return value;
  }
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const entry = entries.find((item) => item?.test?.id === "discord-canary");
  if (!entry) {
    throw new Error("qa evidence missing discord-canary.");
  }
  const generatedAt = requireString(value.generatedAt, "qa evidence generatedAt");
  const status = entry.result?.status === "pass" ? "pass" : "fail";
  const timing = entry.result?.timing;
  const rttMs =
    timing && typeof timing === "object" && !Array.isArray(timing) ? timing.rttMs : undefined;
  if (rttMs !== undefined && (typeof rttMs !== "number" || !Number.isFinite(rttMs))) {
    throw new Error("qa evidence discord-canary timing must include finite rttMs when present.");
  }
  const passed = entries.filter((item) => item?.result?.status === "pass").length;
  return {
    startedAt: generatedAt,
    finishedAt: generatedAt,
    counts: {
      total: entries.length,
      passed,
      failed: entries.length - passed,
    },
    scenarios: [
      {
        id: "discord-canary",
        status,
        ...(rttMs === undefined ? {} : { rttMs }),
        details: entry.result?.details ?? entry.result?.failure?.reason,
      },
    ],
    credentials: {
      source: entry.execution?.provider?.fixture ?? entry.execution?.provider?.auth,
      role: "ci",
    },
  };
}

function safeRunLabel(input) {
  return input.replace(/[^a-zA-Z0-9.-]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function quantile(sorted, q) {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

function stats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: sorted.length ? total / sorted.length : undefined,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    maxMs: sorted.at(-1),
  };
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function readSampleEntries(samplesPath) {
  const text = await fs.readFile(samplesPath, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const [summaryPath, observedMessagesPath, resourceMetricsPath] = line.split("\t");
      if (!summaryPath) {
        throw new Error(`Invalid sample-paths line ${index + 1}: expected a summary path.`);
      }
      return { summaryPath, observedMessagesPath, resourceMetricsPath };
    });
}

async function existingRunIds() {
  return await existingChannelRunIds(DISCORD_CHANNEL.id);
}

function extractCanaryRtt(observedMessages) {
  if (!Array.isArray(observedMessages)) {
    throw new Error("discord observed messages must be an array.");
  }
  const matched = observedMessages.find(
    (message) =>
      message?.scenarioId === "discord-canary" &&
      message?.matchedScenario === true &&
      typeof message.triggerTimestamp === "string" &&
      typeof message.timestamp === "string",
  );
  if (!matched) {
    return undefined;
  }
  const sentAtMs = Date.parse(matched.triggerTimestamp);
  const repliedAtMs = Date.parse(matched.timestamp);
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(repliedAtMs)) {
    return undefined;
  }
  const rttMs = Math.max(0, Math.round(repliedAtMs - sentAtMs));
  return Number.isFinite(rttMs) ? rttMs : undefined;
}

function extractSummaryDurationRtt(summary) {
  const startedAtMs = Date.parse(summary.startedAt);
  const finishedAtMs = Date.parse(summary.finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return undefined;
  }
  const rttMs = Math.max(0, Math.round(finishedAtMs - startedAtMs));
  return Number.isFinite(rttMs) ? rttMs : undefined;
}

function extractScenarioMeasurement(scenario) {
  const measurement = scenario?.rttMeasurement;
  if (typeof measurement !== "object" || measurement === null || Array.isArray(measurement)) {
    return undefined;
  }
  const finalMatchedReplyRttMs = measurement.finalMatchedReplyRttMs;
  if (typeof finalMatchedReplyRttMs !== "number" || !Number.isFinite(finalMatchedReplyRttMs)) {
    return undefined;
  }
  const source =
    typeof measurement.source === "string" && measurement.source.trim()
      ? measurement.source
      : "request-to-observed-message";
  return {
    finalMatchedReplyRttMs: Math.max(0, Math.round(finalMatchedReplyRttMs)),
    ...(typeof measurement.requestStartedAt === "string"
      ? { requestStartedAt: measurement.requestStartedAt }
      : {}),
    ...(typeof measurement.responseObservedAt === "string"
      ? { responseObservedAt: measurement.responseObservedAt }
      : {}),
    source,
  };
}

function extractSummaryScenarioRtt(scenario) {
  if (scenario?.status !== "pass") {
    return undefined;
  }
  return typeof scenario.rttMs === "number" && Number.isFinite(scenario.rttMs)
    ? Math.max(0, Math.round(scenario.rttMs))
    : undefined;
}

function extractGatewayResourceMetrics(summary) {
  const metrics = summary.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return {};
  }
  return Object.fromEntries(
    [
      "gatewayProcessRssStartBytes",
      "gatewayProcessRssEndBytes",
      "gatewayProcessRssDeltaBytes",
      "gatewayProcessRssPeakBytes",
      "gatewayProcessRssPeakDeltaBytes",
    ].flatMap((metricName) => {
      const value = metrics[metricName];
      return typeof value === "number" && Number.isFinite(value) ? [[metricName, value]] : [];
    }),
  );
}

async function readSample(entry, index) {
  const summary = validateSummary(normalizeEvidenceSummary(await readJson(path.resolve(entry.summaryPath))));
  const observedMessages = entry.observedMessagesPath
    ? await readJson(path.resolve(entry.observedMessagesPath))
    : [];
  const resources = entry.resourceMetricsPath
    ? await readResourceMetrics(path.resolve(entry.resourceMetricsPath))
    : undefined;
  const scenario = summary.scenarios.find((item) => item?.id === "discord-canary");
  const rttMeasurement = extractScenarioMeasurement(scenario);
  const summaryRttMs = extractSummaryScenarioRtt(scenario);
  const observedRttMs = extractCanaryRtt(observedMessages);
  const rttMs = rttMeasurement?.finalMatchedReplyRttMs ?? summaryRttMs ?? observedRttMs;
  const rttSource =
    rttMeasurement?.source ??
    (summaryRttMs !== undefined
      ? "summary-rtt"
      : observedRttMs !== undefined
        ? "observed-message"
        : undefined);
  return {
    index,
    summary,
    status: scenario?.status === "pass" && rttMs !== undefined ? "pass" : "fail",
    rttMs,
    rttSource,
    rttMeasurement,
    details: scenario?.details,
    durationRttMs: scenario?.status === "pass" ? extractSummaryDurationRtt(summary) : undefined,
    resources: {
      ...(resources ?? {}),
      ...extractGatewayResourceMetrics(summary),
    },
  };
}

function buildRunId(startedAt, spec) {
  return `${startedAt.replaceAll(":", "").replaceAll(".", "")}-${safeRunLabel(spec)}-discord-rtt`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = await readSampleEntries(path.resolve(args.samplesPath));
  if (entries.length === 0) {
    throw new Error("No Discord RTT samples to import.");
  }

  const samples = [];
  for (let index = 0; index < entries.length; index += 1) {
    samples.push(await readSample(entries[index], index + 1));
  }
  const startedAt = samples[0].summary.startedAt;
  const finishedAt = samples.at(-1).summary.finishedAt;
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    throw new Error("Discord RTT sample timestamps must be parseable.");
  }

  const runId = buildRunId(startedAt, args.spec);
  const seen = await existingRunIds();
  if (seen.has(runId)) {
    throw new Error(`Discord RTT run already imported: ${runId}`);
  }

  const warmSamples = samples.flatMap((sample) => (sample.status === "pass" ? [sample.rttMs] : []));
  const failedSamples = samples.length - warmSamples.length;
  const resources = aggregateResources(samples.flatMap((sample) => sample.resources ?? []), {
    kind: "process-max-rss",
    scope: "qa-command",
    command: "pnpm openclaw qa discord",
  });
  const runDir = path.join(channelRunsDir(DISCORD_CHANNEL.id), runId);
  const resultPath = channelResultPath(DISCORD_CHANNEL.id, runId);
  const result = {
    channel: {
      ...DISCORD_CHANNEL,
    },
    package: {
      spec: args.spec,
      version: args.version,
    },
    run: {
      id: runId,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      status: failedSamples === 0 ? "pass" : "fail",
    },
    mode: {
      providerMode: args.providerMode,
      scenarios: ["discord-canary"],
      credentialSource: samples[0].summary.credentials?.source,
      credentialRole: samples[0].summary.credentials?.role,
    },
    rtt: {
      warmSamples,
      failedSamples,
      sources: [...new Set(samples.filter((sample) => sample.status === "pass").map((sample) => sample.rttSource))],
      ...stats(warmSamples),
    },
    ...(resources ? { resources } : {}),
    discord: {
      samples: samples.map((sample) => ({
        index: sample.index,
        status: sample.status,
        ...(sample.rttMs === undefined ? {} : { rttMs: sample.rttMs }),
        ...(sample.rttSource ? { rttSource: sample.rttSource } : {}),
        ...(sample.rttMeasurement ? { rttMeasurement: sample.rttMeasurement } : {}),
        ...(sample.durationRttMs === undefined ? {} : { durationRttMs: sample.durationRttMs }),
        ...(sample.details ? { details: sample.details } : {}),
        ...(sample.resources ? { resources: sample.resources } : {}),
      })),
    },
    artifacts: {
      resultPath,
    },
  };

  if (args.requirePass && result.run.status !== "pass") {
    throw new Error(`Discord RTT run failed: ${runId}`);
  }

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await appendChannelRow(DISCORD_CHANNEL.id, result);
  process.stdout.write(`imported ${runId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
