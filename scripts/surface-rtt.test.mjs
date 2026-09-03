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
const IMPORT_SCRIPT = path.join(REPO_ROOT, "scripts/import-surface-rtt.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-surface-test-"));
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

test("imports Control UI surface RTT from performance events", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "qa-suite-summary.json");
  const metricsPath = path.join(workspace, "sample-1", "resource-metrics.env");
  const eventsPath = path.join(workspace, "sample-1", "control-ui-events.json");
  await writeJson(summaryPath, {
    counts: { total: 1, passed: 1, failed: 0 },
    run: {
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      providerMode: "mock-openai",
    },
    scenarios: [
      {
        id: "control-ui-qa-channel-image-roundtrip",
        title: "Control UI plus qa-channel image roundtrip",
        status: "pass",
      },
    ],
  });
  await writeJson(eventsPath, [
    { event: "control-ui.rpc", payload: { method: "chat.send", ok: true, durationMs: 41 } },
    { event: "control-ui.rpc", payload: { method: "sessions.list", ok: true, durationMs: 17 } },
  ]);
  await fs.writeFile(metricsPath, "max_rss_kb=204800\nelapsed_seconds=2.5\nattempts=2\n");
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\t${metricsPath}\t${eventsPath}\n`);

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      samplesPath,
      "--surface",
      "control-ui",
      "--spec",
      "openclaw@main",
      "--version",
      "2026.5.16+abcdef1234",
      "--provider-mode",
      "mock-openai",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(path.join(workspace, "data/surfaces/control-ui/2026.5.16+abcdef1234.jsonl"));
  assert.equal(row.surface.id, "control-ui");
  assert.equal(row.surface.scenario, "control-ui-qa-channel-image-roundtrip");
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [17]);
  assert.deepEqual(row.rtt.sources, ["control-ui.rpc"]);
  assert.equal(row.rtt.p50Ms, 17);
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.polling.retryCount, 1);
});

test("imports native Gateway RPC surface RTT from scenario measurements", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "qa-suite-summary.json");
  await writeJson(summaryPath, {
    counts: { total: 1, passed: 1, failed: 0 },
    run: {
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      providerMode: "gateway-rpc",
    },
    scenarios: [
      {
        id: "rpc-gateway-smoke",
        title: "Gateway RPC loopback smoke",
        status: "pass",
        rttMeasurement: {
          finalMatchedReplyRttMs: 45,
          method: "health,config.get",
          source: "gateway-rpc",
        },
      },
    ],
  });
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\n`);

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      samplesPath,
      "--surface",
      "rpc",
      "--spec",
      "openclaw@main",
      "--version",
      "2026.5.16+abcdef1234",
      "--provider-mode",
      "gateway-rpc",
      "--scenario",
      "rpc-gateway-smoke",
      "--require-pass",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(path.join(workspace, "data/surfaces/rpc/2026.5.16+abcdef1234.jsonl"));
  assert.equal(row.surface.id, "rpc");
  assert.equal(row.surface.scenario, "rpc-gateway-smoke");
  assert.equal(row.run.status, "pass");
  assert.equal(row.mode.providerMode, "gateway-rpc");
  assert.equal(row.mode.source, "surface-import");
  assert.deepEqual(row.rtt.warmSamples, [45]);
  assert.deepEqual(row.rtt.sources, ["gateway-rpc"]);
  assert.equal(row.rtt.p50Ms, 45);
  assert.equal(row.samples[0].rttMeasurement.method, "health,config.get");
});

test("imports explicit native Gateway RPC failure evidence", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "qa-suite-summary.json");
  const metricsPath = path.join(workspace, "sample-1", "resource-metrics.env");
  await writeJson(summaryPath, {
    counts: { total: 1, passed: 0, failed: 1 },
    run: {
      startedAt: "2026-05-28T00:00:00.000Z",
      finishedAt: "2026-05-28T00:00:02.000Z",
      providerMode: "gateway-rpc",
    },
    scenarios: [
      {
        id: "rpc-gateway-smoke",
        title: "Gateway RPC loopback smoke",
        status: "fail",
        details: "Gateway failed to become ready",
      },
    ],
  });
  await fs.writeFile(metricsPath, "max_rss_kb=204800\nelapsed_seconds=2.5\nattempts=1\n");
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\t${metricsPath}\n`);

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      samplesPath,
      "--surface",
      "rpc",
      "--spec",
      "openclaw@2026.5.28-beta.1",
      "--version",
      "2026.5.28-beta.1",
      "--provider-mode",
      "gateway-rpc",
      "--scenario",
      "rpc-gateway-smoke",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(
    path.join(workspace, "data/surfaces/rpc/2026.5.28-beta.1.jsonl"),
  );
  assert.equal(row.run.status, "fail");
  assert.deepEqual(row.rtt.warmSamples, []);
  assert.equal(row.rtt.failedSamples, 1);
  assert.equal(row.samples[0].details, "Gateway failed to become ready");
  const result = JSON.parse(
    await fs.readFile(path.join(workspace, row.artifacts.resultPath), "utf8"),
  );
  assert.deepEqual(result, row);
});
