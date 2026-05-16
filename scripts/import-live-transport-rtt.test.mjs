import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_SCRIPT = path.join(REPO_ROOT, "scripts/import-live-transport-rtt.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-test-"));
}

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonl(pathname) {
  const text = await fs.readFile(pathname, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("imports live transport summary RTT samples", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "slack-qa-summary.json");
  const resourceMetricsPath = path.join(workspace, "sample-1", "resource-metrics.env");
  await writeJson(summaryPath, {
    credentials: { kind: "slack", role: "ci", source: "convex" },
    startedAt: "2026-05-16T00:00:00.000Z",
    finishedAt: "2026-05-16T00:00:02.000Z",
    counts: { total: 1, passed: 1, failed: 0 },
    scenarios: [
      {
        id: "slack-canary",
        title: "Slack canary",
        status: "pass",
        details: "reply matched",
        rttMs: 321,
      },
    ],
  });
  await fs.writeFile(resourceMetricsPath, "max_rss_kb=204800\nelapsed_seconds=2.5\nattempts=2\n");
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\t\t${resourceMetricsPath}\n`);

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      samplesPath,
      "--channel",
      "slack",
      "--spec",
      "openclaw@main",
      "--version",
      "2026.5.16+abcdef1234",
      "--provider-mode",
      "mock-openai",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(path.join(workspace, "data/channel-rtt/slack.jsonl"));
  assert.equal(row.channel.id, "slack");
  assert.equal(row.channel.scenario, "slack-canary");
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [321]);
  assert.equal(row.rtt.p50Ms, 321);
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.resources.maxRssKb.p50, 204800);
  assert.deepEqual(row.resources.elapsedSecondsSamples, [2.5]);
  assert.deepEqual(row.polling.attemptSamples, [2]);
  assert.equal(row.polling.retryCount, 1);
  assert.equal(row.polling.maxAttempts, 2);
  assert.equal(row.samples[0].attempts, 2);
});

test("falls back to observed message timestamps when summaries do not carry RTT", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "discord-qa-summary.json");
  const observedPath = path.join(workspace, "sample-1", "discord-qa-observed-messages.json");
  await writeJson(summaryPath, {
    credentials: { kind: "discord", role: "ci", source: "convex" },
    startedAt: "2026-05-16T01:00:00.000Z",
    finishedAt: "2026-05-16T01:00:05.000Z",
    counts: { total: 1, passed: 1, failed: 0 },
    scenarios: [
      {
        id: "discord-canary",
        title: "Discord canary",
        status: "pass",
        details: "reply matched",
      },
    ],
  });
  await writeJson(observedPath, [
    {
      scenarioId: "discord-canary",
      matchedScenario: true,
      triggerTimestamp: "2026-05-16T01:00:01.000Z",
      timestamp: "2026-05-16T01:00:01.456Z",
    },
  ]);
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\t${observedPath}\n`);

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      samplesPath,
      "--channel",
      "discord",
      "--spec",
      "openclaw@main",
      "--version",
      "2026.5.16+abcdef1234",
      "--provider-mode",
      "mock-openai",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(path.join(workspace, "data/channel-rtt/discord.jsonl"));
  assert.equal(row.channel.id, "discord");
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [456]);
});

test("can require imported channel samples to pass", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "slack-qa-summary.json");
  await writeJson(summaryPath, {
    credentials: { kind: "slack", role: "ci", source: "convex" },
    startedAt: "2026-05-16T02:00:00.000Z",
    finishedAt: "2026-05-16T02:00:05.000Z",
    counts: { total: 1, passed: 0, failed: 1 },
    scenarios: [
      {
        id: "slack-canary",
        title: "Slack canary",
        status: "fail",
        details: "credential pool exhausted",
      },
    ],
  });
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\n`);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        IMPORT_SCRIPT,
        samplesPath,
        "--channel",
        "slack",
        "--spec",
        "openclaw@main",
        "--version",
        "2026.5.16+abcdef1234",
        "--provider-mode",
        "mock-openai",
        "--require-pass",
      ],
      { cwd: workspace },
    ),
    /Channel RTT run failed/u,
  );

  const [row] = await readJsonl(path.join(workspace, "data/channel-rtt/slack.jsonl"));
  assert.equal(row.run.status, "fail");
  assert.deepEqual(row.rtt.warmSamples, []);
  assert.equal(row.rtt.failedSamples, 1);
});
