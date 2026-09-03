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

function modernEvidence({
  artifacts = [
    { kind: "summary", path: "qa-suite-summary.json", source: "qa-suite" },
    { kind: "report", path: "qa-suite-report.md", source: "qa-suite" },
  ],
  status = "pass",
  timing,
  title = "Slack canary echo",
} = {}) {
  return {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-09-03T08:44:53.550Z",
    entries: [
      {
        test: { id: "slack-canary", title },
        execution: {
          provider: { fixture: "mock-openai" },
          artifacts,
        },
        result: {
          status,
          ...(timing ? { timing } : {}),
        },
      },
    ],
  };
}

function qaSuiteSummary({
  scenarioName = "Slack canary echo",
  scenarioStatus = "pass",
  steps = [
    {
      name: "Slack canary echo",
      status: "pass",
      details: "reply matched in 2857ms",
    },
  ],
} = {}) {
  return {
    scenarios: [{ name: scenarioName, status: scenarioStatus, steps }],
    counts: {
      total: 1,
      passed: scenarioStatus === "pass" ? 1 : 0,
      failed: scenarioStatus === "pass" ? 0 : 1,
    },
  };
}

async function importModernSlack({
  companion = qaSuiteSummary(),
  companionBytes,
  evidence = modernEvidence(),
  includeCompanion = true,
  observed,
} = {}) {
  const workspace = await makeWorkspace();
  const sampleDir = path.join(workspace, "sample-1");
  const summaryPath = path.join(sampleDir, "rtt-summary.json");
  const observedPath = path.join(sampleDir, "slack-qa-observed-messages.json");
  await writeJson(summaryPath, evidence);
  if (companionBytes !== undefined) {
    await fs.writeFile(path.join(sampleDir, "qa-suite-summary.json"), companionBytes);
  } else if (includeCompanion) {
    await writeJson(path.join(sampleDir, "qa-suite-summary.json"), companion);
  }
  if (observed !== undefined) {
    await writeJson(observedPath, observed);
  }
  const samplesPath = path.join(workspace, "samples.tsv");
  await fs.writeFile(samplesPath, `${summaryPath}\t${observed ? observedPath : ""}\n`);
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
      "2026.7.2-beta.2",
      "--provider-mode",
      "mock-openai",
    ],
    { cwd: workspace },
  );
  const [row] = await readJsonl(
    path.join(workspace, "data/channels/slack/2026.7.2-beta.2.jsonl"),
  );
  return { row, workspace };
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
    metrics: {
      gatewayProcessRssStartBytes: 100_000_000,
      gatewayProcessRssEndBytes: 125_000_000,
      gatewayProcessRssDeltaBytes: 25_000_000,
      gatewayProcessRssPeakBytes: 140_000_000,
      gatewayProcessRssPeakDeltaBytes: 40_000_000,
    },
    scenarios: [
      {
        id: "slack-canary",
        title: "Slack canary",
        status: "pass",
        details: "reply matched",
        rttMs: 321,
        rttMeasurement: {
          finalMatchedReplyRttMs: 333,
          requestStartedAt: "2026-05-16T00:00:00.500Z",
          responseObservedAt: "2026-05-16T00:00:00.833Z",
          source: "request-to-observed-message",
        },
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

  const [row] = await readJsonl(path.join(workspace, "data/channels/slack/2026.5.16+abcdef1234.jsonl"));
  assert.equal(row.channel.id, "slack");
  assert.equal(row.channel.scenario, "slack-canary");
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [333]);
  assert.deepEqual(row.rtt.sources, ["request-to-observed-message"]);
  assert.equal(row.rtt.p50Ms, 333);
  assert.deepEqual(row.resources.measurement, {
    kind: "process-max-rss",
    scope: "qa-command",
    command: "pnpm openclaw qa slack",
  });
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.resources.maxRssKb.p50, 204800);
  assert.deepEqual(row.resources.elapsedSecondsSamples, [2.5]);
  assert.deepEqual(row.resources.gatewayProcessRssPeakBytesSamples, [140_000_000]);
  assert.equal(row.resources.gatewayProcessRssPeakBytes.p50, 140_000_000);
  assert.equal(row.resources.gatewayProcessRssPeakDeltaBytes.p50, 40_000_000);
  assert.deepEqual(row.polling.attemptSamples, [2]);
  assert.equal(row.polling.retryCount, 1);
  assert.equal(row.polling.maxAttempts, 2);
  assert.equal(row.samples[0].attempts, 2);
  assert.equal(row.samples[0].rttSource, "request-to-observed-message");
  assert.deepEqual(row.samples[0].rttMeasurement, {
    finalMatchedReplyRttMs: 333,
    requestStartedAt: "2026-05-16T00:00:00.500Z",
    responseObservedAt: "2026-05-16T00:00:00.833Z",
    source: "request-to-observed-message",
  });
});

test("imports channel qa-evidence summaries", async () => {
  const workspace = await makeWorkspace();
  const summaryPath = path.join(workspace, "sample-1", "qa-evidence.json");
  await writeJson(summaryPath, {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-05-16T00:03:00.000Z",
    entries: [
      {
        test: { id: "slack-canary", title: "Slack canary echo" },
        execution: { provider: { fixture: "mock-openai" } },
        result: { status: "pass", timing: { rttMs: 456 } },
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
      "--channel",
      "slack",
      "--spec",
      "openclaw@main",
      "--version",
      "2026.5.16+qa-evidence",
      "--provider-mode",
      "mock-openai",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(
    path.join(workspace, "data/channels/slack/2026.5.16+qa-evidence.jsonl"),
  );
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [456]);
  assert.deepEqual(row.rtt.sources, ["summary-rtt"]);
});

test("imports RTT from the exact modern Slack qa-suite companion shape", async () => {
  const { row } = await importModernSlack();

  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [2857]);
  assert.deepEqual(row.rtt.sources, ["qa-suite-details"]);
  assert.equal(row.samples[0].rttSource, "qa-suite-details");
});

test("keeps structured and observed RTT ahead of qa-suite details", async () => {
  const observed = [
    {
      scenarioId: "slack-canary",
      matchedScenario: true,
      triggerTimestamp: "2026-09-03T08:44:50.000Z",
      timestamp: "2026-09-03T08:44:50.777Z",
    },
  ];
  const structured = await importModernSlack({
    evidence: modernEvidence({ timing: { rttMs: 456 } }),
    observed,
  });
  assert.deepEqual(structured.row.rtt.warmSamples, [456]);
  assert.deepEqual(structured.row.rtt.sources, ["summary-rtt"]);

  const observedFallback = await importModernSlack({ observed });
  assert.deepEqual(observedFallback.row.rtt.warmSamples, [777]);
  assert.deepEqual(observedFallback.row.rtt.sources, ["observed-message"]);
});

for (const {
  name,
  companion,
  evidence,
  includeCompanion,
} of [
  {
    name: "wrong suite scenario title",
    companion: qaSuiteSummary({ scenarioName: "Another scenario" }),
  },
  {
    name: "failed evidence",
    evidence: modernEvidence({ status: "fail" }),
  },
  {
    name: "failed suite scenario",
    companion: qaSuiteSummary({ scenarioStatus: "fail" }),
  },
  {
    name: "failed matching step",
    companion: qaSuiteSummary({
      steps: [
        {
          name: "Slack canary echo",
          status: "fail",
          details: "reply matched in 2857ms",
        },
      ],
    }),
  },
  {
    name: "unanchored suite details",
    companion: qaSuiteSummary({
      steps: [
        {
          name: "Slack canary echo",
          status: "pass",
          details: "completed; reply matched in 2857ms",
        },
      ],
    }),
  },
  {
    name: "ambiguous suite details",
    companion: qaSuiteSummary({
      steps: [
        {
          name: "Slack canary echo",
          status: "pass",
          details: "reply matched in 2857ms",
        },
        {
          name: "Slack canary echo",
          status: "pass",
          details: "reply matched in 2900ms; duplicate",
        },
      ],
    }),
  },
  {
    name: "missing suite companion",
    includeCompanion: false,
  },
]) {
  test(`imports a failed sample for ${name}`, async () => {
    const { row } = await importModernSlack({
      companion,
      evidence,
      includeCompanion,
    });
    assert.equal(row.run.status, "fail");
    assert.deepEqual(row.rtt.warmSamples, []);
    assert.equal(row.samples[0].rttMs, undefined);
  });
}

for (const { name, path: artifactPath, error } of [
  {
    name: "absolute artifact paths",
    path: "/tmp/qa-suite-summary.json",
    error: /artifact path must be relative/u,
  },
  {
    name: "Windows absolute artifact paths",
    path: "C:\\temp\\qa-suite-summary.json",
    error: /artifact path must be relative/u,
  },
  {
    name: "traversal artifact paths",
    path: "../qa-suite-summary.json",
    error: /artifact path must be a filename/u,
  },
  {
    name: "relative artifact paths with separators",
    path: "nested/qa-suite-summary.json",
    error: /artifact path must be a filename/u,
  },
  {
    name: "NUL artifact paths",
    path: "qa-suite-summary.json\0",
    error: /artifact path must not contain NUL/u,
  },
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(
      importModernSlack({
        evidence: modernEvidence({
          artifacts: [{ kind: "summary", path: artifactPath, source: "qa-suite" }],
        }),
      }),
      error,
    );
  });
}

test("rejects duplicate qa-suite summary artifacts", async () => {
  await assert.rejects(
    importModernSlack({
      evidence: modernEvidence({
        artifacts: [
          { kind: "summary", path: "qa-suite-summary.json", source: "qa-suite" },
          { kind: "summary", path: "qa-suite-summary.json", source: "qa-suite" },
        ],
      }),
    }),
    /exactly one qa-suite summary artifact/u,
  );
});

test("rejects malformed qa-suite companion JSON", async () => {
  await assert.rejects(
    importModernSlack({ companionBytes: "{not-json}\n" }),
    /Unexpected token|Expected property name/u,
  );
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

  const [row] = await readJsonl(path.join(workspace, "data/channels/discord/2026.5.16+abcdef1234.jsonl"));
  assert.equal(row.channel.id, "discord");
  assert.equal(row.run.status, "pass");
  assert.deepEqual(row.rtt.warmSamples, [456]);
  assert.deepEqual(row.rtt.sources, ["observed-message"]);
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

  await assert.rejects(
    fs.stat(path.join(workspace, "data/channels/slack/2026.5.16+abcdef1234.jsonl")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.stat(path.join(workspace, "runs/slack")),
    { code: "ENOENT" },
  );
});
