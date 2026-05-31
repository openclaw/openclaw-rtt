import fs from "node:fs/promises";
import path from "node:path";
import { aggregateResources, numericStats } from "./resource-metrics.mjs";
import {
  appendSurfaceRow,
  existingSurfaceRunIds,
  surfaceResultPath,
} from "./surface-storage.mjs";
import { resolveSurfaceRttSurface, surfaceRttRunsDir } from "./surface-rtt-config.mjs";

function usage() {
  return [
    "Usage: node scripts/import-surface-rtt.mjs <sample-paths.tsv>",
    "  --surface <rpc|control-ui>",
    "  --spec <openclaw@spec>",
    "  --version <version-or-ref>",
    "  [--provider-mode <mock-openai|live-frontier>]",
    "  [--scenario <scenario-id>]",
    "  [--require-pass]",
    "",
    "sample-paths.tsv columns: summaryPath [resourceMetricsPath] [performanceEventsPath]",
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
    if (arg === "--surface") {
      args.surfaceId = argv[(index += 1)];
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
  if (!args.samplesPath || !args.surfaceId || !args.spec || !args.version) {
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
  const run = summary.run && typeof summary.run === "object" ? summary.run : summary;
  requireString(run.startedAt, "summary startedAt");
  requireString(run.finishedAt, "summary finishedAt");
  if (!Array.isArray(summary.scenarios)) {
    throw new Error("summary.scenarios must be an array.");
  }
  const counts = requireObject(summary.counts, "summary.counts");
  requireNumber(counts.total, "summary.counts.total");
  requireNumber(counts.passed, "summary.counts.passed");
  requireNumber(counts.failed, "summary.counts.failed");
  return { ...summary, startedAt: run.startedAt, finishedAt: run.finishedAt };
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
      const [summaryPath, resourceMetricsPath, performanceEventsPath] = line.split("\t");
      if (!summaryPath) {
        throw new Error(`Invalid sample-paths line ${index + 1}: expected summary path.`);
      }
      return { summaryPath, resourceMetricsPath, performanceEventsPath };
    });
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
  const scenario =
    summary.scenarios.find((item) => item?.id === scenarioId) ??
    summary.scenarios.find((item) => item?.name === scenarioId || item?.title === scenarioId);
  if (!scenario) {
    const available = summary.scenarios
      .map((item) => item?.id ?? item?.name ?? item?.title)
      .filter(Boolean)
      .join(", ");
    throw new Error(`summary missing scenario ${scenarioId}; available: ${available || "<none>"}`);
  }
  return scenario;
}

function normalizeMeasurement(value, fallbackSource) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const rttMs =
    typeof value.finalMatchedReplyRttMs === "number"
      ? value.finalMatchedReplyRttMs
      : typeof value.durationMs === "number"
        ? value.durationMs
        : typeof value.rttMs === "number"
          ? value.rttMs
          : undefined;
  if (typeof rttMs !== "number" || !Number.isFinite(rttMs)) {
    return undefined;
  }
  const source =
    typeof value.source === "string" && value.source.trim() ? value.source : fallbackSource;
  return {
    rttMs: Math.max(0, Math.round(rttMs)),
    measurement: {
      finalMatchedReplyRttMs: Math.max(0, Math.round(rttMs)),
      ...(typeof value.requestStartedAt === "string"
        ? { requestStartedAt: value.requestStartedAt }
        : {}),
      ...(typeof value.responseObservedAt === "string"
        ? { responseObservedAt: value.responseObservedAt }
        : {}),
      ...(typeof value.method === "string" ? { method: value.method } : {}),
      source,
    },
    source,
  };
}

function extractJsonDetailsMeasurement(scenario, fallbackSource) {
  if (typeof scenario.details !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(scenario.details);
    return (
      normalizeMeasurement(parsed.rttMeasurement, fallbackSource) ??
      normalizeMeasurement(parsed.surfaceRttMeasurement, fallbackSource) ??
      normalizeMeasurement(parsed.controlUiRttMeasurement, fallbackSource)
    );
  } catch {
    return undefined;
  }
}

function extractSummaryMeasurement(summary, scenario, surfaceId) {
  const fallbackSource = surfaceId === "control-ui" ? "control-ui-performance" : "gateway-rpc";
  return (
    normalizeMeasurement(scenario.rttMeasurement, fallbackSource) ??
    normalizeMeasurement(scenario.surfaceRttMeasurement, fallbackSource) ??
    normalizeMeasurement(scenario.controlUiRttMeasurement, fallbackSource) ??
    extractJsonDetailsMeasurement(scenario, fallbackSource) ??
    normalizeMeasurement(summary.surfaceRttMeasurement, fallbackSource) ??
    normalizeMeasurement(summary.metrics?.surfaceRttMeasurement, fallbackSource)
  );
}

function normalizePerformanceEvents(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.events)) {
    return value.events;
  }
  if (Array.isArray(value?.eventLog)) {
    return value.eventLog;
  }
  if (Array.isArray(value?.eventLogBuffer)) {
    return value.eventLogBuffer;
  }
  return [];
}

async function extractPerformanceMeasurement(pathname, surfaceId) {
  if (!pathname) {
    return undefined;
  }
  const events = normalizePerformanceEvents(await readJson(path.resolve(pathname)));
  const matching = events
    .map((event) => ({
      event: event?.event,
      payload: event?.payload && typeof event.payload === "object" ? event.payload : event,
    }))
    .filter(({ event, payload }) => {
      if (surfaceId === "control-ui") {
        return (
          event === "control-ui.rtt" ||
          event === "control-ui.rpc" ||
          event === "control-ui.tab.visible" ||
          event === "control-ui.refresh"
        );
      }
      return event === "control-ui.rpc" || payload?.kind === "gateway-rpc";
    })
    .flatMap(({ event, payload }) => {
      const durationMs = payload?.durationMs;
      if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
        return [];
      }
      if (payload?.ok === false) {
        return [];
      }
      return [
        {
          rttMs: Math.max(0, Math.round(durationMs)),
          measurement: {
            finalMatchedReplyRttMs: Math.max(0, Math.round(durationMs)),
            ...(typeof payload.method === "string" ? { method: payload.method } : {}),
            source: event ?? (surfaceId === "control-ui" ? "control-ui-performance" : "gateway-rpc"),
          },
          source: event ?? (surfaceId === "control-ui" ? "control-ui-performance" : "gateway-rpc"),
        },
      ];
    });
  if (matching.length === 0) {
    return undefined;
  }
  const values = matching.map((entry) => entry.rttMs).sort((left, right) => left - right);
  const p50 = quantile(values, 0.5);
  return {
    rttMs: p50,
    measurement: {
      finalMatchedReplyRttMs: p50,
      source: matching[0].source,
    },
    source: matching[0].source,
  };
}

async function readSample(entry, index, surfaceId, scenarioId) {
  const summary = validateSummary(await readJson(path.resolve(entry.summaryPath)));
  const scenario = selectScenario(summary, scenarioId);
  const measurement =
    extractSummaryMeasurement(summary, scenario, surfaceId) ??
    (await extractPerformanceMeasurement(entry.performanceEventsPath, surfaceId));
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
      id: scenario.id ?? scenarioId,
      rttMs: measurement?.rttMs,
      rttMeasurement: measurement?.measurement,
      rttSource: measurement?.source,
      status: scenario.status === "pass" && measurement?.rttMs !== undefined ? "pass" : "fail",
      title: scenario.title ?? scenario.name,
    },
  };
}

function buildRunId(startedAt, surfaceId, scenarioId, spec) {
  return [
    startedAt.replaceAll(":", "").replaceAll(".", ""),
    safeRunLabel(spec),
    safeRunLabel(surfaceId),
    safeRunLabel(scenarioId),
    "rtt",
  ].join("-");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const surface = resolveSurfaceRttSurface(args.surfaceId);
  const scenarioId = args.scenario ?? surface.defaultScenario;
  const entries = await readSampleEntries(path.resolve(args.samplesPath));
  if (entries.length === 0) {
    throw new Error("No surface RTT samples to import.");
  }

  const samples = [];
  for (let index = 0; index < entries.length; index += 1) {
    samples.push(await readSample(entries[index], index + 1, surface.id, scenarioId));
  }

  const startedAt = samples[0].summary.startedAt;
  const finishedAt = samples.at(-1).summary.finishedAt;
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    throw new Error("Surface RTT sample timestamps must be parseable.");
  }

  const runId = buildRunId(startedAt, surface.id, scenarioId, args.spec);
  const seen = await existingSurfaceRunIds(surface.id);
  if (seen.has(runId)) {
    throw new Error(`Surface RTT run already imported: ${runId}`);
  }

  const warmSamples = samples.flatMap((sample) =>
    sample.scenario.status === "pass" ? [sample.scenario.rttMs] : [],
  );
  const resources =
    aggregateResources(samples.map((sample) => sample.resources), {
      kind: "process-max-rss",
      scope: "qa-command",
      command: surface.command,
    }) ?? {
      measurement: {
        kind: "process-max-rss",
        scope: "qa-command",
        command: surface.command,
      },
      maxRssKbSamples: [],
      elapsedSecondsSamples: [],
      maxRssKb: numericStats([]),
      elapsedSeconds: numericStats([]),
    };
  const attemptSamples = samples.map((sample) => sample.attempts);
  const failedSamples = samples.length - warmSamples.length;
  const runDir = path.join(surfaceRttRunsDir(surface.id), runId);
  const resultPath = surfaceResultPath(surface.id, runId);
  const result = {
    surface: {
      id: surface.id,
      label: surface.label,
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
      retryCount: attemptSamples.reduce((total, attempts) => total + Math.max(0, attempts - 1), 0),
      maxAttempts: Math.max(...attemptSamples),
    },
    mode: {
      providerMode: args.providerMode,
      source: "surface-import",
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
    throw new Error(`Surface RTT run failed: ${runId}`);
  }

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await appendSurfaceRow(surface.id, result);
  process.stdout.write(`imported ${runId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
