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
const IMPORT_SCRIPT = path.join(REPO_ROOT, "scripts/import-discord-rtt.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-discord-import-test-"));
}

async function writeEvidenceSamples(workspace, samples) {
  const samplePaths = [];
  for (const [index, sample] of samples.entries()) {
    const sampleDir = path.join(workspace, `sample-${index + 1}`);
    const summaryPath = path.join(sampleDir, "qa-evidence.json");
    await fs.mkdir(sampleDir, { recursive: true });
    await fs.writeFile(
      summaryPath,
      `${JSON.stringify({
        kind: "openclaw.qa.evidence-summary",
        schemaVersion: 2,
        generatedAt: sample.generatedAt,
        entries: [
          {
            test: { id: "discord-canary", title: "Discord canary echo" },
            execution: { provider: { fixture: "mock-openai" } },
            result: sample.result,
          },
        ],
      })}\n`,
    );
    samplePaths.push(`${summaryPath}\t\t`);
  }
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${samplePaths.join("\n")}\n`);
  return samplesPath;
}

async function importEvidenceSamples(workspace, samples, { spec, version, requirePass = false }) {
  const args = [
    IMPORT_SCRIPT,
    await writeEvidenceSamples(workspace, samples),
    "--spec",
    spec,
    "--version",
    version,
  ];
  if (requirePass) {
    args.push("--require-pass");
  }
  return await execFileAsync(process.execPath, args, { cwd: workspace });
}

async function readDiscordRow(workspace, version) {
  const rows = await fs.readFile(
    path.join(workspace, `data/channels/discord/${version}.jsonl`),
    "utf8",
  );
  return JSON.parse(rows.trim());
}

test("does not write failed Discord runs when pass is required", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-summary.json"),
    `${JSON.stringify({
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:45.000Z",
      counts: { total: 1, passed: 0, failed: 1 },
      scenarios: [{ id: "discord-canary", status: "fail", details: "timed out" }],
      credentials: { source: "convex", role: "ci" },
    })}\n`,
  );
  await fs.writeFile(path.join(sampleDir, "discord-qa-observed-messages.json"), "[]\n");
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "discord-qa-summary.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\n`,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      IMPORT_SCRIPT,
      path.join(workspace, "samples.tsv"),
      "--spec",
      "openclaw@2026.4.29",
      "--version",
      "2026.4.29",
      "--require-pass",
    ], { cwd: workspace }),
    /Discord RTT run failed/u,
  );

  await assert.rejects(fs.stat(path.join(workspace, "data/channels/discord/2026.5.16.jsonl")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(workspace, "runs/discord")), { code: "ENOENT" });
});

test("imports Discord qa-evidence summaries", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "qa-evidence.json"),
    `${JSON.stringify({
      kind: "openclaw.qa.evidence-summary",
      schemaVersion: 2,
      generatedAt: "2026-06-22T03:54:37.214Z",
      entries: [
        {
          test: { id: "discord-canary", title: "Discord canary echo" },
          execution: { provider: { fixture: "mock-openai" } },
          result: { status: "pass", timing: { rttMs: 1903 } },
        },
      ],
    })}\n`,
  );
  await fs.writeFile(path.join(sampleDir, "discord-qa-observed-messages.json"), "[]\n");
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "qa-evidence.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\n`,
  );

  await execFileAsync(process.execPath, [
    IMPORT_SCRIPT,
    path.join(workspace, "samples.tsv"),
    "--spec",
    "openclaw@2026.6.10-beta.1",
    "--version",
    "2026.6.10-beta.1",
    "--require-pass",
  ], { cwd: workspace });

  const [row] = (await fs.readFile(path.join(workspace, "data/channels/discord/2026.6.10-beta.1.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(row.run.status, "pass");
  assert.equal(row.run.durationMs, 0);
  assert.equal(row.rtt.p50Ms, 1903);
  assert.deepEqual(row.rtt.sources, ["summary-rtt"]);
  assert.equal(row.mode.providerMode, "mock-openai");
  assert.equal(row.discord.samples[0].durationRttMs, 0);
});

test("preserves Discord qa-evidence RTT measurement without the retired sidecar", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  const rttMeasurement = {
    finalMatchedReplyRttMs: 1875,
    requestStartedAt: "2026-07-18T03:59:07.000Z",
    responseObservedAt: "2026-07-18T03:59:08.875Z",
    source: "request-to-observed-message",
  };
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "qa-evidence.json"),
    `${JSON.stringify({
      kind: "openclaw.qa.evidence-summary",
      schemaVersion: 2,
      generatedAt: "2026-07-18T03:59:09.424Z",
      entries: [
        {
          test: { id: "discord-canary", title: "Discord canary echo" },
          execution: { provider: { fixture: "mock-openai" } },
          result: {
            status: "pass",
            timing: { rttMs: 2140 },
            rttMeasurement,
          },
        },
      ],
    })}\n`,
  );
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "qa-evidence.json")}\t\t\n`,
  );

  await execFileAsync(process.execPath, [
    IMPORT_SCRIPT,
    path.join(workspace, "samples.tsv"),
    "--spec",
    "openclaw@main",
    "--version",
    "2026.7.2+3659c85e53",
    "--require-pass",
  ], { cwd: workspace });

  const [row] = (await fs.readFile(
    path.join(workspace, "data/channels/discord/2026.7.2+3659c85e53.jsonl"),
    "utf8",
  ))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(row.run.status, "pass");
  assert.equal(row.run.startedAt, rttMeasurement.requestStartedAt);
  assert.equal(row.run.finishedAt, rttMeasurement.responseObservedAt);
  assert.equal(row.run.durationMs, 1875);
  assert.equal(row.rtt.p50Ms, 1875);
  assert.deepEqual(row.rtt.sources, ["request-to-observed-message"]);
  assert.deepEqual(row.discord.samples[0].rttMeasurement, rttMeasurement);
  assert.equal(row.discord.samples[0].durationRttMs, 1875);
});

test("imports failed Discord qa-evidence summaries without timing", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "qa-evidence.json"),
    `${JSON.stringify({
      kind: "openclaw.qa.evidence-summary",
      schemaVersion: 2,
      generatedAt: "2026-06-24T05:52:51.059Z",
      entries: [
        {
          test: { id: "discord-canary", title: "Discord canary echo" },
          execution: { provider: { fixture: "mock-openai" } },
          result: {
            status: "fail",
            failure: {
              reason: "timed out after 45000ms waiting for Discord message",
            },
          },
        },
      ],
    })}\n`,
  );
  await fs.writeFile(path.join(sampleDir, "discord-qa-observed-messages.json"), "[]\n");
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "qa-evidence.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\n`,
  );

  await execFileAsync(process.execPath, [
    IMPORT_SCRIPT,
    path.join(workspace, "samples.tsv"),
    "--spec",
    "openclaw@2026.5.16-beta.6",
    "--version",
    "2026.5.16-beta.6",
  ], { cwd: workspace });

  const [row] = (await fs.readFile(path.join(workspace, "data/channels/discord/2026.5.16-beta.6.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(row.run.status, "fail");
  assert.equal(row.run.durationMs, 0);
  assert.deepEqual(row.rtt.warmSamples, []);
  assert.equal(row.rtt.failedSamples, 1);
  assert.equal(row.discord.samples[0].details, "timed out after 45000ms waiting for Discord message");
  assert.equal(row.discord.samples[0].durationRttMs, undefined);
});

test("imports failed structured Discord evidence with authoritative lifecycle bounds", async () => {
  const workspace = await makeWorkspace();
  const rttMeasurement = {
    finalMatchedReplyRttMs: 2250,
    requestStartedAt: "2026-07-18T04:00:00.000Z",
    responseObservedAt: "2026-07-18T04:00:02.250Z",
    source: "request-to-observed-message",
  };
  await importEvidenceSamples(
    workspace,
    [
      {
        generatedAt: "2026-07-18T04:00:03.000Z",
        result: {
          status: "fail",
          rttMeasurement,
          failure: { reason: "reply failed a later assertion" },
        },
      },
    ],
    { spec: "openclaw@2026.7.2", version: "2026.7.2" },
  );

  const row = await readDiscordRow(workspace, "2026.7.2");
  assert.equal(row.run.status, "fail");
  assert.equal(row.run.startedAt, rttMeasurement.requestStartedAt);
  assert.equal(row.run.finishedAt, rttMeasurement.responseObservedAt);
  assert.equal(row.run.durationMs, 2250);
  assert.deepEqual(row.rtt.warmSamples, []);
  assert.deepEqual(row.rtt.sources, []);
  assert.equal(row.rtt.failedSamples, 1);
  assert.equal(row.discord.samples[0].durationRttMs, 2250);
  assert.deepEqual(row.discord.samples[0].rttMeasurement, rttMeasurement);
});

test("rejects malformed structured Discord measurement bounds", async (t) => {
  const cases = [
    {
      name: "null",
      rttMeasurement: null,
      error: /discord-canary rttMeasurement must be an object/u,
    },
    {
      name: "malformed",
      rttMeasurement: {
        finalMatchedReplyRttMs: 1000,
        requestStartedAt: "not-a-timestamp",
        responseObservedAt: "2026-07-18T04:00:01.000Z",
      },
      error: /must define a positive parseable interval/u,
    },
    {
      name: "partial",
      rttMeasurement: {
        finalMatchedReplyRttMs: 1000,
        requestStartedAt: "2026-07-18T04:00:00.000Z",
      },
      error: /responseObservedAt must be a non-empty string/u,
    },
    {
      name: "equal",
      rttMeasurement: {
        finalMatchedReplyRttMs: 1000,
        requestStartedAt: "2026-07-18T04:00:00.000Z",
        responseObservedAt: "2026-07-18T04:00:00.000Z",
      },
      error: /must define a positive parseable interval/u,
    },
    {
      name: "reversed",
      rttMeasurement: {
        finalMatchedReplyRttMs: 1000,
        requestStartedAt: "2026-07-18T04:00:01.000Z",
        responseObservedAt: "2026-07-18T04:00:00.000Z",
      },
      error: /must define a positive parseable interval/u,
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const workspace = await makeWorkspace();
      await assert.rejects(
        importEvidenceSamples(
          workspace,
          [
            {
              generatedAt: "2026-07-18T04:00:02.000Z",
              result: {
                status: "pass",
                timing: { rttMs: 1000 },
                rttMeasurement: entry.rttMeasurement,
              },
            },
          ],
          { spec: "openclaw@main", version: "2026.7.2+invalid", requirePass: true },
        ),
        entry.error,
      );
      await assert.rejects(fs.stat(path.join(workspace, "runs/discord")), { code: "ENOENT" });
    });
  }
});

test("aggregates structured Discord lifecycle bounds independent of sample order", async () => {
  const workspace = await makeWorkspace();
  await importEvidenceSamples(
    workspace,
    [
      {
        generatedAt: "2026-07-18T04:00:23.000Z",
        result: {
          status: "pass",
          rttMeasurement: {
            finalMatchedReplyRttMs: 2000,
            requestStartedAt: "2026-07-18T04:00:20.000Z",
            responseObservedAt: "2026-07-18T04:00:22.000Z",
          },
        },
      },
      {
        generatedAt: "2026-07-18T04:00:12.000Z",
        result: {
          status: "pass",
          rttMeasurement: {
            finalMatchedReplyRttMs: 1500,
            requestStartedAt: "2026-07-18T04:00:10.000Z",
            responseObservedAt: "2026-07-18T04:00:11.500Z",
          },
        },
      },
    ],
    { spec: "openclaw@main", version: "2026.7.2+reverse", requirePass: true },
  );

  const row = await readDiscordRow(workspace, "2026.7.2+reverse");
  assert.equal(row.run.startedAt, "2026-07-18T04:00:10.000Z");
  assert.equal(row.run.finishedAt, "2026-07-18T04:00:22.000Z");
  assert.equal(row.run.durationMs, 12000);
  assert.deepEqual(row.discord.samples.map((sample) => sample.durationRttMs), [2000, 1500]);
});

test("imports Discord resource metrics without changing RTT stats", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-summary.json"),
    `${JSON.stringify({
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:45.000Z",
      counts: { total: 1, passed: 1, failed: 0 },
      metrics: {
        gatewayProcessRssStartBytes: 100_000_000,
        gatewayProcessRssEndBytes: 125_000_000,
        gatewayProcessRssDeltaBytes: 25_000_000,
        gatewayProcessRssPeakBytes: 140_000_000,
        gatewayProcessRssPeakDeltaBytes: 40_000_000,
      },
      scenarios: [{ id: "discord-canary", status: "pass" }],
      credentials: { source: "convex", role: "ci" },
    })}\n`,
  );
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-observed-messages.json"),
    `${JSON.stringify([
      {
        scenarioId: "discord-canary",
        matchedScenario: true,
        triggerTimestamp: "2026-05-16T00:00:10.000Z",
        timestamp: "2026-05-16T00:00:15.250Z",
      },
    ])}\n`,
  );
  await fs.writeFile(
    path.join(sampleDir, "resource-metrics.env"),
    "Command exited with non-zero status 1\nmax_rss_kb=204800\nelapsed_seconds=12.5\n",
  );
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "discord-qa-summary.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\t${path.join(sampleDir, "resource-metrics.env")}\n`,
  );

  await execFileAsync(process.execPath, [
    IMPORT_SCRIPT,
    path.join(workspace, "samples.tsv"),
    "--spec",
    "openclaw@2026.5.16",
    "--version",
    "2026.5.16",
    "--require-pass",
  ], { cwd: workspace });

  const [row] = (await fs.readFile(path.join(workspace, "data/channels/discord/2026.5.16.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(row.rtt.p50Ms, 5250);
  assert.equal(row.rtt.p95Ms, 5250);
  assert.deepEqual(row.rtt.sources, ["observed-message"]);
  assert.deepEqual(row.resources.measurement, {
    kind: "process-max-rss",
    scope: "qa-command",
    command: "pnpm openclaw qa discord",
  });
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.resources.maxRssKb.p50, 204800);
  assert.equal(row.resources.elapsedSeconds.p50, 12.5);
  assert.deepEqual(row.resources.gatewayProcessRssPeakBytesSamples, [140_000_000]);
  assert.equal(row.resources.gatewayProcessRssPeakBytes.p50, 140_000_000);
  assert.equal(row.resources.gatewayProcessRssPeakDeltaBytes.p50, 40_000_000);
});

test("prefers Discord structured RTT measurement over legacy fallbacks", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-summary.json"),
    `${JSON.stringify({
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:45.000Z",
      counts: { total: 1, passed: 1, failed: 0 },
      scenarios: [{
        id: "discord-canary",
        status: "pass",
        rttMs: 6123,
        rttMeasurement: {
          finalMatchedReplyRttMs: 6789,
          requestStartedAt: "2026-05-16T00:00:10.000Z",
          responseObservedAt: "2026-05-16T00:00:16.789Z",
          source: "request-to-observed-message",
        },
      }],
      credentials: { source: "convex", role: "ci" },
    })}\n`,
  );
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-observed-messages.json"),
    `${JSON.stringify([
      {
        scenarioId: "discord-canary",
        matchedScenario: true,
      },
    ])}\n`,
  );
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "discord-qa-summary.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\n`,
  );

  await execFileAsync(process.execPath, [
    IMPORT_SCRIPT,
    path.join(workspace, "samples.tsv"),
    "--spec",
    "openclaw@2026.5.17",
    "--version",
    "2026.5.17",
    "--require-pass",
  ], { cwd: workspace });

  const result = JSON.parse(
    await fs.readFile(
      path.join(workspace, "runs/discord/2026-05-16T000010000Z-openclaw_2026.5.17-discord-rtt/result.json"),
      "utf8",
    ),
  );
  assert.equal(result.rtt.p50Ms, 6789);
  assert.deepEqual(result.rtt.sources, ["request-to-observed-message"]);
  assert.equal(result.discord.samples[0].rttSource, "request-to-observed-message");
  assert.deepEqual(result.discord.samples[0].rttMeasurement, {
    finalMatchedReplyRttMs: 6789,
    requestStartedAt: "2026-05-16T00:00:10.000Z",
    responseObservedAt: "2026-05-16T00:00:16.789Z",
    source: "request-to-observed-message",
  });
  assert.equal(result.discord.samples[0].durationRttMs, 6789);
});

test("does not treat Discord whole-command duration as RTT", async () => {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(
    path.join(sampleDir, "discord-qa-summary.json"),
    `${JSON.stringify({
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:45.000Z",
      counts: { total: 1, passed: 1, failed: 0 },
      scenarios: [{ id: "discord-canary", status: "pass", details: "reply matched" }],
      credentials: { source: "convex", role: "ci" },
    })}\n`,
  );
  await fs.writeFile(path.join(sampleDir, "discord-qa-observed-messages.json"), "[]\n");
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `${path.join(sampleDir, "discord-qa-summary.json")}\t${path.join(
      sampleDir,
      "discord-qa-observed-messages.json",
    )}\n`,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      IMPORT_SCRIPT,
      path.join(workspace, "samples.tsv"),
      "--spec",
      "openclaw@2026.5.18",
      "--version",
      "2026.5.18",
      "--require-pass",
    ], { cwd: workspace }),
    /Discord RTT run failed/u,
  );
});
