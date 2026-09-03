import fs from "node:fs/promises";
import path from "node:path";
import {
  appendChannelRow,
  channelResultPath,
  existingChannelRunIds,
} from "./channel-storage.mjs";
import {
  channelRttRunsDir,
  resolveChannelRttChannel,
} from "./channel-rtt-config.mjs";
import { aggregateResources } from "./resource-metrics.mjs";

function usage() {
  return [
    "Usage: node scripts/import-live-transport-rtt.mjs <sample-paths.tsv>",
    "  --channel <discord|slack|telegram|whatsapp>",
    "  --spec <openclaw@spec>",
    "  --version <version-or-ref>",
    "  [--provider-mode <mock-openai|live-frontier>]",
    "  [--scenario <scenario-id>]",
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
    if (arg === "--channel") {
      args.channelId = argv[(index += 1)];
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
    if (arg === "--scenario") {
      args.scenario = argv[(index += 1)];
      continue;
    }
    if (arg === "--require-pass") {
      args.requirePass = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.samplesPath || !args.channelId || !args.spec || !args.version) {
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
  requireString(summary.startedAt, "summary.startedAt");
  requireString(summary.finishedAt, "summary.finishedAt");
  if (!Array.isArray(summary.scenarios)) {
    throw new Error("summary.scenarios must be an array.");
  }
  const counts = requireObject(summary.counts, "summary.counts");
  requireNumber(counts.total, "summary.counts.total");
  requireNumber(counts.passed, "summary.counts.passed");
  requireNumber(counts.failed, "summary.counts.failed");
  return summary;
}

function parseRunBounds(startedAt, finishedAt) {
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    finishedAtMs < startedAtMs
  ) {
    return undefined;
  }
  return { finishedAt, finishedAtMs, startedAt, startedAtMs };
}

async function evidenceRunBounds(value, entry, result, summaryPath) {
  const generatedAt = requireString(value.generatedAt, "qa evidence generatedAt");
  const measurement = result.rttMeasurement;
  const measurementBounds =
    measurement && typeof measurement === "object" && !Array.isArray(measurement)
      ? parseRunBounds(measurement.requestStartedAt, measurement.responseObservedAt)
      : undefined;
  const fallback = measurementBounds ?? parseRunBounds(generatedAt, generatedAt);
  const artifactFilename = selectQaSuiteArtifact(entry);
  if (!artifactFilename) {
    return fallback;
  }
  let suite;
  try {
    suite = await readJson(path.join(path.dirname(summaryPath), artifactFilename));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
  const run = suite?.run;
  return parseRunBounds(run?.startedAt, run?.finishedAt) ?? fallback;
}

async function normalizeEvidenceSummary(value, scenarioId, summaryPath) {
  if (value?.kind !== "openclaw.qa.evidence-summary") {
    return { summary: value };
  }
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const entry = entries.find((item) => item?.test?.id === scenarioId);
  if (!entry) {
    throw new Error(`qa evidence missing ${scenarioId}.`);
  }
  const result = requireObject(entry.result, `qa evidence ${scenarioId} result`);
  const runBounds = await evidenceRunBounds(value, entry, result, summaryPath);
  const timing = result.timing;
  const rttMs =
    timing && typeof timing === "object" && !Array.isArray(timing) ? timing.rttMs : undefined;
  const passed = entries.filter((item) => item?.result?.status === "pass").length;
  return {
    evidenceEntry: entry,
    summary: {
      startedAt: runBounds.startedAt,
      finishedAt: runBounds.finishedAt,
      counts: {
        total: entries.length,
        passed,
        failed: entries.length - passed,
      },
      scenarios: [
        {
          id: scenarioId,
          title: entry.test?.title,
          status: result.status === "pass" ? "pass" : "fail",
          ...(typeof rttMs === "number" && Number.isFinite(rttMs)
            ? { rttMs: Math.max(0, Math.round(rttMs)) }
            : {}),
          ...(result.rttMeasurement === undefined
            ? {}
            : { rttMeasurement: result.rttMeasurement }),
          ...(typeof result.details === "string" ? { details: result.details } : {}),
        },
      ],
      credentials: {
        source: entry.execution?.provider?.fixture ?? entry.execution?.provider?.auth,
        role: "ci",
      },
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

function numericStats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    avg: sorted.length ? total / sorted.length : undefined,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.at(-1),
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
        throw new Error(`Invalid sample-paths line ${index + 1}: expected summary path.`);
      }
      return { summaryPath, observedMessagesPath, resourceMetricsPath };
    });
}

function extractObservedRtt(observedMessages, scenarioId) {
  if (!Array.isArray(observedMessages)) {
    throw new Error("observed messages must be an array.");
  }
  const matched = observedMessages.find(
    (message) =>
      message?.scenarioId === scenarioId &&
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

// Some released evidence declared a suite summary but omitted structured RTT.
// Follow only that exact sibling artifact so arbitrary files or prose cannot become measurements.
function selectQaSuiteArtifact(entry) {
  const artifacts = Array.isArray(entry?.execution?.artifacts)
    ? entry.execution.artifacts.filter(
        (artifact) => artifact?.kind === "summary" && artifact?.source === "qa-suite",
      )
    : [];
  if (artifacts.length === 0) {
    return undefined;
  }
  if (artifacts.length !== 1) {
    throw new Error("qa evidence must declare exactly one qa-suite summary artifact.");
  }
  const artifactPath = artifacts[0]?.path;
  if (typeof artifactPath !== "string" || artifactPath.length === 0) {
    throw new Error("qa-suite summary artifact path must be a non-empty string.");
  }
  if (artifactPath.includes("\0")) {
    throw new Error("qa-suite summary artifact path must not contain NUL.");
  }
  if (path.posix.isAbsolute(artifactPath) || path.win32.isAbsolute(artifactPath)) {
    throw new Error("qa-suite summary artifact path must be relative.");
  }
  if (artifactPath.includes("/") || artifactPath.includes("\\")) {
    throw new Error("qa-suite summary artifact path must be a filename.");
  }
  if (artifactPath === "." || artifactPath === "..") {
    throw new Error("qa-suite summary artifact path must not traverse directories.");
  }
  if (artifactPath !== "qa-suite-summary.json") {
    throw new Error("qa-suite summary artifact path must be qa-suite-summary.json.");
  }
  return artifactPath;
}

async function extractQaSuiteRtt(evidenceEntry, summaryPath) {
  if (evidenceEntry?.result?.status !== "pass") {
    return undefined;
  }
  const artifactFilename = selectQaSuiteArtifact(evidenceEntry);
  if (!artifactFilename) {
    return undefined;
  }
  let suite;
  try {
    suite = await readJson(path.join(path.dirname(summaryPath), artifactFilename));
  } catch (error) {
    if (error?.code === "ENOENT") {
      // Some immutable runs declared the suite artifact but did not upload it.
      // That leaves timing unprovable, so retain the sample as failed.
      return undefined;
    }
    throw error;
  }
  const title = evidenceEntry.test?.title;
  if (typeof title !== "string" || !Array.isArray(suite?.scenarios)) {
    return undefined;
  }
  // Historical suite scenarios expose no stable id. Their exact unique title
  // is the only cross-artifact key; ambiguity must not produce a measurement.
  const scenarios = suite.scenarios.filter((scenario) => scenario?.name === title);
  if (scenarios.length !== 1 || scenarios[0]?.status !== "pass") {
    return undefined;
  }
  const steps = Array.isArray(scenarios[0].steps) ? scenarios[0].steps : [];
  const matches = steps.flatMap((step) => {
    if (step?.name !== title || step?.status !== "pass" || typeof step.details !== "string") {
      return [];
    }
    const match = /^reply matched in ([1-9][0-9]*)ms(?:;|$)/u.exec(step.details);
    if (!match) {
      return [];
    }
    const rttMs = Number(match[1]);
    return Number.isSafeInteger(rttMs) ? [rttMs] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

async function readResourceMetrics(pathname) {
  if (!pathname) {
    return {};
  }
  const text = await fs.readFile(path.resolve(pathname), "utf8");
  const metrics = {};
  for (const line of text.split("\n")) {
    const [key, value] = line.split("=");
    if (!key || value === undefined) {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      metrics[key] = numeric;
    }
  }
  return metrics;
}

function readAttemptCount(value) {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("resource metrics attempts must be a positive integer.");
  }
  return value;
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

function selectScenario(summary, scenarioId) {
  const scenario = summary.scenarios.find((item) => item?.id === scenarioId);
  if (!scenario) {
    const available = summary.scenarios.map((item) => item?.id).filter(Boolean).join(", ");
    throw new Error(`summary missing scenario ${scenarioId}; available: ${available || "<none>"}`);
  }
  return scenario;
}

async function readSample(entry, index, scenarioId) {
  const summaryPath = path.resolve(entry.summaryPath);
  const normalized = await normalizeEvidenceSummary(
    await readJson(summaryPath),
    scenarioId,
    summaryPath,
  );
  const summary = validateSummary(normalized.summary);
  const scenario = selectScenario(summary, scenarioId);
  const rttMeasurement = extractScenarioMeasurement(scenario);
  const summaryRttMs =
    typeof scenario.rttMs === "number" && Number.isFinite(scenario.rttMs)
      ? Math.max(0, Math.round(scenario.rttMs))
      : undefined;
  let rttMs = rttMeasurement?.finalMatchedReplyRttMs ?? summaryRttMs;
  let rttSource =
    rttMeasurement?.source ?? (summaryRttMs === undefined ? undefined : "summary-rtt");
  if (rttMs === undefined && entry.observedMessagesPath) {
    rttMs = extractObservedRtt(await readJson(path.resolve(entry.observedMessagesPath)), scenarioId);
    rttSource = rttMs === undefined ? undefined : "observed-message";
  }
  if (rttMs === undefined && normalized.evidenceEntry) {
    rttMs = await extractQaSuiteRtt(normalized.evidenceEntry, summaryPath);
    rttSource = rttMs === undefined ? undefined : "qa-suite-details";
  }
  const resourceMetrics = await readResourceMetrics(entry.resourceMetricsPath);
  const attempts = readAttemptCount(resourceMetrics.attempts);
  return {
    index,
    summary,
    attempts,
    resources: {
      ...(resourceMetrics.max_rss_kb === undefined
        ? {}
        : { maxRssKb: resourceMetrics.max_rss_kb }),
      ...(resourceMetrics.elapsed_seconds === undefined
        ? {}
        : { elapsedSeconds: resourceMetrics.elapsed_seconds }),
      ...extractGatewayResourceMetrics(summary),
    },
    scenario: {
      details: scenario.details,
      id: scenario.id,
      rttMs,
      rttMeasurement,
      rttSource,
      status: scenario.status === "pass" && rttMs !== undefined ? "pass" : "fail",
      title: scenario.title,
    },
  };
}

function buildRunId(startedAt, channelId, scenarioId, spec) {
  return [
    startedAt.replaceAll(":", "").replaceAll(".", ""),
    safeRunLabel(spec),
    safeRunLabel(channelId),
    safeRunLabel(scenarioId),
    "rtt",
  ].join("-");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const channel = resolveChannelRttChannel(args.channelId);
  const scenarioId = args.scenario ?? channel.defaultScenario;
  const entries = await readSampleEntries(path.resolve(args.samplesPath));
  if (entries.length === 0) {
    throw new Error("No channel RTT samples to import.");
  }

  const samples = [];
  for (let index = 0; index < entries.length; index += 1) {
    samples.push(await readSample(entries[index], index + 1, scenarioId));
  }

  const sampleRunBounds = samples.map((sample, index) => {
    const bounds = parseRunBounds(sample.summary.startedAt, sample.summary.finishedAt);
    if (!bounds) {
      throw new Error(`Channel RTT sample ${index + 1} timestamps must form a valid interval.`);
    }
    return bounds;
  });
  const startedAtMs = Math.min(...sampleRunBounds.map((bounds) => bounds.startedAtMs));
  const finishedAtMs = Math.max(...sampleRunBounds.map((bounds) => bounds.finishedAtMs));
  const startedAt = new Date(startedAtMs).toISOString();
  const finishedAt = new Date(finishedAtMs).toISOString();
  if (finishedAtMs < startedAtMs) {
    throw new Error("Channel RTT sample timestamps must form a valid run interval.");
  }

  const runId = buildRunId(startedAt, channel.id, scenarioId, args.spec);
  const seen = await existingChannelRunIds(channel.id);
  if (seen.has(runId)) {
    throw new Error(`Channel RTT run already imported: ${runId}`);
  }

  const warmSamples = samples.flatMap((sample) =>
    sample.scenario.status === "pass" ? [sample.scenario.rttMs] : [],
  );
  const resources =
    aggregateResources(samples.map((sample) => sample.resources), {
      kind: "process-max-rss",
      scope: "qa-command",
      command: `pnpm openclaw qa ${channel.command}`,
    }) ?? {
      measurement: {
        kind: "process-max-rss",
        scope: "qa-command",
        command: `pnpm openclaw qa ${channel.command}`,
      },
      maxRssKbSamples: [],
      elapsedSecondsSamples: [],
      maxRssKb: numericStats([]),
      elapsedSeconds: numericStats([]),
    };
  const attemptSamples = samples.map((sample) => sample.attempts);
  const retryCount = attemptSamples.reduce((total, attempts) => total + Math.max(0, attempts - 1), 0);
  const failedSamples = samples.length - warmSamples.length;
  const runDir = path.join(channelRttRunsDir(channel.id), runId);
  const resultPath = channelResultPath(channel.id, runId);
  const result = {
    channel: {
      id: channel.id,
      label: channel.label,
      scenario: scenarioId,
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
    polling: {
      attemptSamples,
      retryCount,
      maxAttempts: Math.max(...attemptSamples),
    },
    mode: {
      providerMode: args.providerMode,
      credentialSource: samples[0].summary.credentials?.source,
      credentialRole: samples[0].summary.credentials?.role,
    },
    rtt: {
      warmSamples,
      failedSamples,
      sources: [
        ...new Set(
          samples
            .filter((sample) => sample.scenario.status === "pass")
            .flatMap((sample) => (sample.scenario.rttSource ? [sample.scenario.rttSource] : [])),
        ),
      ],
      ...stats(warmSamples),
    },
    resources,
    samples: samples.map((sample) => ({
      index: sample.index,
      status: sample.scenario.status,
      attempts: sample.attempts,
      ...(sample.scenario.rttMs === undefined ? {} : { rttMs: sample.scenario.rttMs }),
      ...(sample.scenario.rttSource ? { rttSource: sample.scenario.rttSource } : {}),
      ...(sample.scenario.rttMeasurement ? { rttMeasurement: sample.scenario.rttMeasurement } : {}),
      ...(sample.resources.maxRssKb === undefined ? {} : { maxRssKb: sample.resources.maxRssKb }),
      ...(sample.resources.elapsedSeconds === undefined
        ? {}
        : { elapsedSeconds: sample.resources.elapsedSeconds }),
      ...(sample.scenario.details ? { details: sample.scenario.details } : {}),
    })),
    artifacts: {
      resultPath,
    },
  };

  if (args.requirePass && result.run.status !== "pass") {
    throw new Error(`Channel RTT run failed: ${runId}`);
  }

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await appendChannelRow(channel.id, result);
  process.stdout.write(`imported ${runId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
