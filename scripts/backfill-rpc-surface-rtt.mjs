import fs from "node:fs/promises";
import path from "node:path";
import { readAllChannelRows } from "./channel-storage.mjs";
import { aggregateResources, numericStats } from "./resource-metrics.mjs";
import {
  appendSurfaceRow,
  readSurfaceRows,
  surfaceResultPath,
  writeSurfaceRows,
} from "./surface-storage.mjs";
import { surfaceRttRunsDir } from "./surface-rtt-config.mjs";

function usage() {
  return [
    "Usage: node scripts/backfill-rpc-surface-rtt.mjs",
    "  [--spec <openclaw@spec>]",
    "  [--version <version-or-ref>]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--spec") {
      args.spec = argv[(index += 1)];
      continue;
    }
    if (arg === "--version") {
      args.version = argv[(index += 1)];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if ((args.spec && !args.version) || (!args.spec && args.version)) {
    throw new Error("--spec and --version must be provided together.");
  }
  return args;
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

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function sampleMeasurement(sample, row) {
  const measurement = sample?.rttMeasurement;
  const rttMs =
    finiteNumber(measurement?.finalMatchedReplyRttMs) ??
    finiteNumber(sample?.rttMs) ??
    finiteNumber(sample?.durationRttMs);
  if (rttMs === undefined) {
    return undefined;
  }
  const source =
    typeof measurement?.source === "string" && measurement.source.trim()
      ? measurement.source
      : typeof sample?.rttSource === "string" && sample.rttSource.trim()
        ? sample.rttSource
        : "channel-rtt-backfill";
  return {
    channel: row.channel,
    runId: row.run?.id,
    rttMs,
    rttSource: `backfill:${source}`,
    rttMeasurement: {
      finalMatchedReplyRttMs: rttMs,
      ...(typeof measurement?.requestStartedAt === "string"
        ? { requestStartedAt: measurement.requestStartedAt }
        : {}),
      ...(typeof measurement?.responseObservedAt === "string"
        ? { responseObservedAt: measurement.responseObservedAt }
        : {}),
      source: `backfill:${source}`,
    },
    ...(sample?.details ? { details: sample.details } : {}),
  };
}

function rowSamples(row) {
  const explicitSamples = [
    ...(Array.isArray(row.samples) ? row.samples : []),
    ...(Array.isArray(row.discord?.samples) ? row.discord.samples : []),
    ...(row.discord && typeof row.discord === "object" && !Array.isArray(row.discord)
      ? [row.discord]
      : []),
  ]
    .map((sample) => sampleMeasurement(sample, row))
    .filter(Boolean);
  if (explicitSamples.length > 0) {
    return explicitSamples;
  }
  return (Array.isArray(row.rtt?.warmSamples) ? row.rtt.warmSamples : [])
    .map(finiteNumber)
    .filter((sample) => sample !== undefined)
    .map((rttMs) => ({
      channel: row.channel,
      runId: row.run?.id,
      rttMs,
      rttSource: "backfill:channel-warm-sample",
      rttMeasurement: {
        finalMatchedReplyRttMs: rttMs,
        source: "backfill:channel-warm-sample",
      },
    }));
}

function resourceSample(row) {
  const maxRssKb =
    row.resources?.maxRssKb?.p50 ??
    (Array.isArray(row.resources?.maxRssKbSamples) ? row.resources.maxRssKbSamples[0] : undefined);
  const elapsedSeconds =
    row.resources?.elapsedSeconds?.p50 ??
    (Array.isArray(row.resources?.elapsedSecondsSamples)
      ? row.resources.elapsedSecondsSamples[0]
      : undefined);
  return {
    ...(typeof maxRssKb === "number" && Number.isFinite(maxRssKb) ? { maxRssKb } : {}),
    ...(typeof elapsedSeconds === "number" && Number.isFinite(elapsedSeconds)
      ? { elapsedSeconds }
      : {}),
  };
}

function buildRunId(version) {
  return `rpc-channel-rtt-backfill-${version.replace(/[^a-zA-Z0-9.+_-]+/gu, "_")}`;
}

function sameRow(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceRow(rows, row) {
  return rows.map((existing) => (existing.run?.id === row.run.id ? row : existing));
}

async function writeResult(row) {
  const runDir = path.join(surfaceRttRunsDir("rpc"), row.run.id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(surfaceResultPath("rpc", row.run.id), `${JSON.stringify(row, null, 2)}\n`);
}

function buildRow(group) {
  const rows = group.rows.sort((left, right) =>
    String(left.run?.startedAt).localeCompare(String(right.run?.startedAt)),
  );
  const samples = rows.flatMap(rowSamples);
  const warmSamples = samples.map((sample) => sample.rttMs);
  const startedAt = rows[0].run.startedAt;
  const finishedAt = rows
    .map((row) => row.run?.finishedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  const resources =
    aggregateResources(rows.map(resourceSample), {
      kind: "process-max-rss",
      scope: "source-channel-runs",
      command: "backfill from data/channels",
    }) ?? {
      measurement: {
        kind: "process-max-rss",
        scope: "source-channel-runs",
        command: "backfill from data/channels",
      },
      maxRssKbSamples: [],
      elapsedSecondsSamples: [],
      maxRssKb: numericStats([]),
      elapsedSeconds: numericStats([]),
    };
  const runId = buildRunId(group.version);
  const resultPath = surfaceResultPath("rpc", runId);
  return {
    surface: {
      id: "rpc",
      label: "RPC",
      scenario: "channel-rtt-backfill",
    },
    package: {
      spec: group.spec,
      version: group.version,
    },
    run: {
      id: runId,
      startedAt,
      finishedAt,
      durationMs:
        Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
          ? finishedAtMs - startedAtMs
          : undefined,
      status: warmSamples.length > 0 ? "pass" : "fail",
    },
    mode: {
      providerMode: "mixed",
      source: "channel-rtt-backfill",
      sourceChannels: [...new Set(rows.map((row) => row.channel?.id).filter(Boolean))].sort(),
    },
    rtt: {
      warmSamples,
      failedSamples: rows.reduce((total, row) => total + Math.max(0, row.rtt?.failedSamples ?? 0), 0),
      sources: [...new Set(samples.map((sample) => sample.rttSource))].sort(),
      ...stats(warmSamples),
    },
    resources,
    samples: samples.map((sample, index) => ({
      index: index + 1,
      status: "pass",
      channel: sample.channel,
      sourceRunId: sample.runId,
      rttMs: sample.rttMs,
      rttSource: sample.rttSource,
      rttMeasurement: sample.rttMeasurement,
      ...(sample.details ? { details: sample.details } : {}),
    })),
    artifacts: {
      resultPath,
      source: "data/channels",
    },
  };
}

function groupRows(rows, args) {
  const groups = new Map();
  for (const row of rows) {
    const spec = row.package?.spec;
    const version = row.package?.version;
    if (typeof spec !== "string" || typeof version !== "string") {
      continue;
    }
    if (args.spec && (spec !== args.spec || version !== args.version)) {
      continue;
    }
    const samples = rowSamples(row);
    if (samples.length === 0) {
      continue;
    }
    const key = `${spec}\0${version}`;
    const group = groups.get(key) ?? { spec, version, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let existingRows = await readSurfaceRows("rpc");
  const existingByRunId = new Map(
    existingRows.map((row) => [row.run?.id, row]).filter(([runId]) => runId),
  );
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const group of groupRows(await readAllChannelRows(), args)) {
    const row = buildRow(group);
    const existing = existingByRunId.get(row.run.id);
    if (existing && sameRow(existing, row)) {
      skipped += 1;
      continue;
    }
    await writeResult(row);
    if (existing) {
      existingRows = replaceRow(existingRows, row);
      await writeSurfaceRows(
        "rpc",
        row.package.version,
        existingRows.filter((existingRow) => existingRow.package?.version === row.package.version),
      );
      existingByRunId.set(row.run.id, row);
      updated += 1;
    } else {
      await appendSurfaceRow("rpc", row);
      existingRows.push(row);
      existingRows.sort((left, right) => String(left.run.startedAt).localeCompare(String(right.run.startedAt)));
      existingByRunId.set(row.run.id, row);
      imported += 1;
    }
  }
  process.stdout.write(
    `imported ${imported} rpc backfill rows; updated ${updated}; skipped ${skipped}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
