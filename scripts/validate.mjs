import { readChannelRows } from "./channel-storage.mjs";
import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";

function assertRun(row, index) {
  if (typeof row !== "object" || row === null) {
    throw new Error(`row ${index} must be an object`);
  }
  if (typeof row.package?.spec !== "string") {
    throw new Error(`row ${index} missing package.spec`);
  }
  if (typeof row.package?.version !== "string") {
    throw new Error(`row ${index} missing package.version`);
  }
  if (typeof row.run?.id !== "string") {
    throw new Error(`row ${index} missing run.id`);
  }
  if (row.run.status !== "pass" && row.run.status !== "fail") {
    throw new Error(`row ${index} has invalid run.status`);
  }
  if (row.rtt?.warmSamples !== undefined && !Array.isArray(row.rtt.warmSamples)) {
    throw new Error(`row ${index} has invalid rtt.warmSamples`);
  }
  assertResources(row, index, "row");
}

function assertDiscordRttRun(row, index) {
  if (typeof row !== "object" || row === null) {
    throw new Error(`Discord RTT row ${index} must be an object`);
  }
  if (typeof row.package?.spec !== "string") {
    throw new Error(`Discord RTT row ${index} missing package.spec`);
  }
  if (typeof row.package?.version !== "string") {
    throw new Error(`Discord RTT row ${index} missing package.version`);
  }
  if (typeof row.run?.id !== "string") {
    throw new Error(`Discord RTT row ${index} missing run.id`);
  }
  if (row.run.status !== "pass" && row.run.status !== "fail") {
    throw new Error(`Discord RTT row ${index} has invalid run.status`);
  }
  if (!Array.isArray(row.rtt?.warmSamples)) {
    throw new Error(`Discord RTT row ${index} missing rtt.warmSamples`);
  }
  if (row.rtt.warmSamples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))) {
    throw new Error(`Discord RTT row ${index} has invalid rtt.warmSamples`);
  }
  assertResources(row, index, "Discord RTT row");
}

function assertResources(row, index, label) {
  if (row.resources === undefined) {
    return;
  }
  if (typeof row.resources !== "object" || row.resources === null || Array.isArray(row.resources)) {
    throw new Error(`${label} ${index} has invalid resources`);
  }
  for (const samplesName of [
    "maxRssKbSamples",
    "elapsedSecondsSamples",
    "gatewayProcessRssStartBytesSamples",
    "gatewayProcessRssEndBytesSamples",
    "gatewayProcessRssDeltaBytesSamples",
    "gatewayProcessRssPeakBytesSamples",
    "gatewayProcessRssPeakDeltaBytesSamples",
  ]) {
    const samples = row.resources[samplesName];
    if (
      samples !== undefined &&
      (!Array.isArray(samples) ||
        samples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample)))
    ) {
      throw new Error(`${label} ${index} has invalid resources.${samplesName}`);
    }
  }
  if (row.resources.measurement !== undefined) {
    if (
      typeof row.resources.measurement !== "object" ||
      row.resources.measurement === null ||
      Array.isArray(row.resources.measurement)
    ) {
      throw new Error(`${label} ${index} has invalid resources.measurement`);
    }
    for (const fieldName of ["kind", "scope", "command"]) {
      const value = row.resources.measurement[fieldName];
      if (value !== undefined && typeof value !== "string") {
        throw new Error(`${label} ${index} has invalid resources.measurement.${fieldName}`);
      }
    }
  }
  for (const [metricName, stats] of Object.entries({
    maxRssKb: row.resources.maxRssKb,
    elapsedSeconds: row.resources.elapsedSeconds,
    gatewayProcessRssStartBytes: row.resources.gatewayProcessRssStartBytes,
    gatewayProcessRssEndBytes: row.resources.gatewayProcessRssEndBytes,
    gatewayProcessRssDeltaBytes: row.resources.gatewayProcessRssDeltaBytes,
    gatewayProcessRssPeakBytes: row.resources.gatewayProcessRssPeakBytes,
    gatewayProcessRssPeakDeltaBytes: row.resources.gatewayProcessRssPeakDeltaBytes,
  })) {
    if (stats === undefined) {
      continue;
    }
    if (typeof stats !== "object" || stats === null || Array.isArray(stats)) {
      throw new Error(`${label} ${index} has invalid resources.${metricName}`);
    }
    for (const statName of ["avg", "p50", "p95", "max"]) {
      const value = stats[statName];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`${label} ${index} has invalid resources.${metricName}.${statName}`);
      }
    }
  }
}

function assertChannelRttRun(row, index) {
  if (typeof row !== "object" || row === null) {
    throw new Error(`Channel RTT row ${index} must be an object`);
  }
  if (typeof row.channel?.id !== "string") {
    throw new Error(`Channel RTT row ${index} missing channel.id`);
  }
  if (typeof row.channel?.label !== "string") {
    throw new Error(`Channel RTT row ${index} missing channel.label`);
  }
  if (typeof row.channel?.scenario !== "string") {
    throw new Error(`Channel RTT row ${index} missing channel.scenario`);
  }
  if (typeof row.package?.spec !== "string") {
    throw new Error(`Channel RTT row ${index} missing package.spec`);
  }
  if (typeof row.package?.version !== "string") {
    throw new Error(`Channel RTT row ${index} missing package.version`);
  }
  if (typeof row.run?.id !== "string") {
    throw new Error(`Channel RTT row ${index} missing run.id`);
  }
  if (row.run.status !== "pass" && row.run.status !== "fail") {
    throw new Error(`Channel RTT row ${index} has invalid run.status`);
  }
  if (row.polling !== undefined) {
    if (typeof row.polling !== "object" || row.polling === null || Array.isArray(row.polling)) {
      throw new Error(`Channel RTT row ${index} has invalid polling`);
    }
    if (
      row.polling.attemptSamples !== undefined &&
      (!Array.isArray(row.polling.attemptSamples) ||
        row.polling.attemptSamples.some(
          (sample) => !Number.isInteger(sample) || sample < 1,
        ))
    ) {
      throw new Error(`Channel RTT row ${index} has invalid polling.attemptSamples`);
    }
    const retryCount = row.polling.retryCount;
    if (retryCount !== undefined && (!Number.isInteger(retryCount) || retryCount < 0)) {
      throw new Error(`Channel RTT row ${index} has invalid polling.retryCount`);
    }
    const maxAttempts = row.polling.maxAttempts;
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
      throw new Error(`Channel RTT row ${index} has invalid polling.maxAttempts`);
    }
  }
  if (!Array.isArray(row.rtt?.warmSamples)) {
    throw new Error(`Channel RTT row ${index} missing rtt.warmSamples`);
  }
  if (row.rtt.warmSamples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))) {
    throw new Error(`Channel RTT row ${index} has invalid rtt.warmSamples`);
  }
  assertResources(row, index, "Channel RTT row");
}

function validateRows(rows, label, assertRow) {
  const seen = new Set();
  rows.forEach((row, index) => {
    assertRow(row, index + 1);
    if (seen.has(row.run.id)) {
      throw new Error(`duplicate ${label} run id: ${row.run.id}`);
    }
    seen.add(row.run.id);
  });
  process.stdout.write(`ok: ${rows.length} ${label} rows\n`);
}

async function validateChannelRttRows() {
  const rows = await readChannelRttRows();
  const seen = new Set();
  rows.forEach((row, index) => {
    assertChannelRttRun(row, index + 1);
    if (seen.has(row.run.id)) {
      throw new Error(`duplicate Channel RTT run id: ${row.run.id}`);
    }
    seen.add(row.run.id);
  });
  process.stdout.write(`ok: ${rows.length} Channel RTT rows\n`);
}

async function main() {
  validateRows(await readChannelRows("telegram"), "RTT", assertRun);
  validateRows(await readChannelRows("discord"), "Discord RTT", assertDiscordRttRun);
  await validateChannelRttRows();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
