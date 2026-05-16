import fs from "node:fs/promises";
import path from "node:path";
import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";

const DATA_PATH = path.resolve("data/rtt.jsonl");
const DISCORD_RTT_DATA_PATH = path.resolve("data/discord-rtt.jsonl");

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
  if (!Array.isArray(row.rtt?.warmSamples)) {
    throw new Error(`Channel RTT row ${index} missing rtt.warmSamples`);
  }
  if (row.rtt.warmSamples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))) {
    throw new Error(`Channel RTT row ${index} has invalid rtt.warmSamples`);
  }
  if (row.resources !== undefined) {
    if (typeof row.resources !== "object" || row.resources === null || Array.isArray(row.resources)) {
      throw new Error(`Channel RTT row ${index} has invalid resources`);
    }
    if (
      row.resources.maxRssKbSamples !== undefined &&
      (!Array.isArray(row.resources.maxRssKbSamples) ||
        row.resources.maxRssKbSamples.some(
          (sample) => typeof sample !== "number" || !Number.isFinite(sample),
        ))
    ) {
      throw new Error(`Channel RTT row ${index} has invalid resources.maxRssKbSamples`);
    }
    for (const [metricName, stats] of Object.entries({
      maxRssKb: row.resources.maxRssKb,
      elapsedSeconds: row.resources.elapsedSeconds,
    })) {
      if (stats === undefined) {
        continue;
      }
      if (typeof stats !== "object" || stats === null || Array.isArray(stats)) {
        throw new Error(`Channel RTT row ${index} has invalid resources.${metricName}`);
      }
      for (const statName of ["avg", "p50", "p95", "max"]) {
        const value = stats[statName];
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
          throw new Error(`Channel RTT row ${index} has invalid resources.${metricName}.${statName}`);
        }
      }
    }
  }
}

async function validateJsonl(pathname, label, assertRow) {
  let text = "";
  try {
    text = await fs.readFile(pathname, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stdout.write(`ok: no ${path.relative(process.cwd(), pathname)} yet\n`);
      return;
    }
    throw error;
  }

  const seen = new Set();
  const lines = text.split("\n").filter(Boolean);
  lines.forEach((line, index) => {
    const row = JSON.parse(line);
    assertRow(row, index + 1);
    if (seen.has(row.run.id)) {
      throw new Error(`duplicate ${label} run id: ${row.run.id}`);
    }
    seen.add(row.run.id);
  });
  process.stdout.write(`ok: ${lines.length} ${label} rows\n`);
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
  await validateJsonl(DATA_PATH, "RTT", assertRun);
  await validateJsonl(DISCORD_RTT_DATA_PATH, "Discord RTT", assertDiscordRttRun);
  await validateChannelRttRows();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
