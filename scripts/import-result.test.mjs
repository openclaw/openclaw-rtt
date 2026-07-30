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
const IMPORT_SCRIPT = path.join(REPO_ROOT, "scripts/import-result.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-import-result-test-"));
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

test("imports a selected Telegram QA scenario as the existing RTT row shape", async () => {
  const workspace = await makeWorkspace();
  const evidencePath = path.join(workspace, "qa-evidence.json");
  const metricsPath = path.join(workspace, "resource-metrics.env");
  await writeJson(evidencePath, {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-06-12T20:00:20.000Z",
    entries: [
      {
        test: {
          kind: "live-transport-check",
          id: "telegram-reply-chain-exact-marker",
          title: "Telegram mentioned message gets a reply",
        },
        execution: {
          packageSource: {
            kind: "npm-package",
            spec: "openclaw@main",
          },
          provider: {
            id: "openai",
            live: false,
            fixture: "mock-openai",
          },
        },
        result: {
          status: "pass",
          timing: {
            rttMs: 1200,
            avgMs: 1300,
            p50Ms: 1200,
            p95Ms: 1800,
            maxMs: 2200,
            samples: 5,
            failedSamples: 1,
          },
        },
      },
    ],
  });
  await fs.writeFile(metricsPath, "max_rss_kb=204800\nelapsed_seconds=22.5\n");

  await execFileAsync(
    process.execPath,
    [
      IMPORT_SCRIPT,
      evidencePath,
      "--version",
      "2026.6.2+abcdef1234",
      "--started-at",
      "2026-06-12T20:00:00.000Z",
      "--finished-at",
      "2026-06-12T20:00:30.000Z",
      "--resource-metrics",
      metricsPath,
      "--scenario",
      "telegram-reply-chain-exact-marker",
    ],
    { cwd: workspace },
  );

  const [row] = await readJsonl(
    path.join(workspace, "data/channels/telegram/2026.6.2+abcdef1234.jsonl"),
  );
  assert.deepEqual(row.channel, {
    id: "telegram",
    label: "Telegram",
    scenario: "telegram-reply-chain-exact-marker",
  });
  assert.equal(row.package.spec, "openclaw@main");
  assert.equal(row.package.version, "2026.6.2+abcdef1234");
  assert.equal(row.run.status, "pass");
  assert.equal(row.run.durationMs, 30_000);
  assert.equal(row.mode.providerMode, "mock-openai");
  assert.deepEqual(row.mode.scenarios, ["telegram-reply-chain-exact-marker"]);
  assert.equal(row.mode.source, "qa-evidence");
  assert.equal(row.rtt.canaryMs, 1200);
  assert.equal(row.rtt.mentionReplyMs, 1200);
  assert.equal(row.rtt.avgMs, 1300);
  assert.equal(row.rtt.p50Ms, 1200);
  assert.equal(row.rtt.p95Ms, 1800);
  assert.equal(row.rtt.maxMs, 2200);
  assert.equal(row.rtt.sampleCount, 5);
  assert.equal(row.rtt.failedSamples, 1);
  assert.deepEqual(row.rtt.sources, ["qa-evidence"]);
  assert.deepEqual(row.resources.measurement, {
    kind: "process-max-rss",
    scope: "release-harness-command",
    command: "pnpm test:docker:npm-telegram-live",
  });
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.resources.maxRssKb.p50, 204800);
  assert.deepEqual(row.resources.elapsedSecondsSamples, [22.5]);
  assert.deepEqual(row.artifacts, {
    resultPath: row.artifacts.resultPath,
  });
  assert.match(row.artifacts.resultPath, /^runs\/telegram\/.+\/result\.json$/u);
});

test("rejects qa-evidence without aggregate Telegram RTT samples", async () => {
  const workspace = await makeWorkspace();
  const evidencePath = path.join(workspace, "qa-evidence.json");
  await writeJson(evidencePath, {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-06-12T20:00:20.000Z",
    entries: [
      {
        test: {
          kind: "live-transport-check",
          id: "channel-canary",
          title: "Telegram mentioned message gets a reply",
        },
        execution: {
          packageSource: {
            kind: "npm-package",
            spec: "openclaw@main",
          },
        },
        result: {
          status: "pass",
          timing: {
            rttMs: 1200,
          },
        },
      },
    ],
  });

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        IMPORT_SCRIPT,
        evidencePath,
        "--version",
        "2026.6.2+abcdef1234",
        "--started-at",
        "2026-06-12T20:00:00.000Z",
        "--finished-at",
        "2026-06-12T20:00:30.000Z",
      ],
      { cwd: workspace },
    ),
    /channel-canary must include positive result\.timing\.samples/u,
  );
});

test("rejects a Telegram scenario that could escape the run directory", async () => {
  const workspace = await makeWorkspace();
  const evidencePath = path.join(workspace, "qa-evidence.json");
  await writeJson(evidencePath, {
    kind: "openclaw.qa.evidence-summary",
    entries: [],
  });

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        IMPORT_SCRIPT,
        evidencePath,
        "--version",
        "2026.6.2+abcdef1234",
        "--scenario",
        "../outside",
        "--started-at",
        "2026-06-12T20:00:00.000Z",
        "--finished-at",
        "2026-06-12T20:00:30.000Z",
      ],
      { cwd: workspace },
    ),
    /--scenario must contain only letters, numbers, dots, and hyphens/u,
  );
  await assert.rejects(fs.access(path.join(workspace, "runs/outside")));
});

test("rejects an explicitly empty Telegram scenario", async () => {
  const workspace = await makeWorkspace();
  const evidencePath = path.join(workspace, "qa-evidence.json");
  await writeJson(evidencePath, {
    kind: "openclaw.qa.evidence-summary",
    entries: [],
  });

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        IMPORT_SCRIPT,
        evidencePath,
        "--version",
        "2026.6.2+abcdef1234",
        "--scenario",
        "",
        "--started-at",
        "2026-06-12T20:00:00.000Z",
        "--finished-at",
        "2026-06-12T20:00:30.000Z",
      ],
      { cwd: workspace },
    ),
    /--scenario must be a non-empty string/u,
  );
});

test("rejects a Telegram scenario flag without a value", async () => {
  const workspace = await makeWorkspace();
  const evidencePath = path.join(workspace, "qa-evidence.json");
  await writeJson(evidencePath, {
    kind: "openclaw.qa.evidence-summary",
    entries: [],
  });

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        IMPORT_SCRIPT,
        evidencePath,
        "--version",
        "2026.6.2+abcdef1234",
        "--started-at",
        "2026-06-12T20:00:00.000Z",
        "--finished-at",
        "2026-06-12T20:00:30.000Z",
        "--scenario",
      ],
      { cwd: workspace },
    ),
    /--scenario requires a value/u,
  );
});
