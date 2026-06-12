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
const BACKFILL_SCRIPT = path.join(REPO_ROOT, "scripts/backfill-release-rss.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-rss-backfill-test-"));
}

test("backfills Telegram RSS without touching RTT p50/p95", async () => {
  const workspace = await makeWorkspace();
  const runId = "2026-05-16T000000000Z-openclaw_2026.5.16-1";
  const row = {
    package: { spec: "openclaw@2026.5.16", version: "2026.5.16" },
    run: {
      id: runId,
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:01:00.000Z",
      durationMs: 60000,
      status: "pass",
    },
    mode: { providerMode: "mock-openai", scenarios: ["telegram-mentioned-message-reply"] },
    rtt: { warmSamples: [1000, 2000], failedSamples: 0, p50Ms: 1000, p95Ms: 2000 },
  };
  await fs.mkdir(path.join(workspace, "data/channels/telegram"), { recursive: true });
  await fs.writeFile(path.join(workspace, "data/channels/telegram/2026.5.16.jsonl"), `${JSON.stringify(row)}\n`);
  await fs.mkdir(path.join(workspace, "runs/telegram", runId), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "runs/telegram", runId, "result.json"),
    `${JSON.stringify(row, null, 2)}\n`,
  );
  await fs.writeFile(path.join(workspace, "resource-metrics.env"), "max_rss_kb=409600\nelapsed_seconds=88.1\n");

  await execFileAsync(process.execPath, [
    BACKFILL_SCRIPT,
    "--family",
    "telegram",
    "--spec",
    "openclaw@2026.5.16",
    "--version",
    "2026.5.16",
    "--resource-metrics",
    path.join(workspace, "resource-metrics.env"),
  ], { cwd: workspace });

  const [updated] = (await fs.readFile(path.join(workspace, "data/channels/telegram/2026.5.16.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(updated.rtt.p50Ms, 1000);
  assert.equal(updated.rtt.p95Ms, 2000);
  assert.deepEqual(updated.resources.measurement, {
    kind: "process-max-rss",
    scope: "release-harness-command",
    command: "pnpm test:docker:npm-telegram-live",
  });
  assert.deepEqual(updated.resources.maxRssKbSamples, [409600]);
  assert.equal(updated.resources.maxRssKb.max, 409600);

  const copiedResult = JSON.parse(
    await fs.readFile(path.join(workspace, "runs/telegram", runId, "result.json"), "utf8"),
  );
  assert.equal(copiedResult.resources.maxRssKb.p50, 409600);
});

test("backfills Discord RSS from per-sample metrics without touching RTT p50/p95", async () => {
  const workspace = await makeWorkspace();
  const runId = "2026-05-16T000000000Z-openclaw_2026.5.16-discord-rtt";
  const row = {
    package: { spec: "openclaw@2026.5.16", version: "2026.5.16" },
    run: {
      id: runId,
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:01:00.000Z",
      durationMs: 60000,
      status: "pass",
    },
    mode: { providerMode: "mock-openai", scenarios: ["discord-canary"] },
    rtt: { warmSamples: [5000, 7000], failedSamples: 0, p50Ms: 5000, p95Ms: 7000 },
  };
  await fs.mkdir(path.join(workspace, "data/channels/discord"), { recursive: true });
  await fs.writeFile(path.join(workspace, "data/channels/discord/2026.5.16.jsonl"), `${JSON.stringify(row)}\n`);
  await fs.mkdir(path.join(workspace, "runs/discord", runId), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "runs/discord", runId, "result.json"),
    `${JSON.stringify(row, null, 2)}\n`,
  );
  await fs.writeFile(path.join(workspace, "resource-1.env"), "max_rss_kb=204800\nelapsed_seconds=10\n");
  await fs.writeFile(path.join(workspace, "resource-2.env"), "max_rss_kb=307200\nelapsed_seconds=20\n");
  await fs.writeFile(
    path.join(workspace, "samples.tsv"),
    `summary-1.json\tobserved-1.json\t${path.join(workspace, "resource-1.env")}\nsummary-2.json\tobserved-2.json\t${path.join(
      workspace,
      "resource-2.env",
    )}\n`,
  );

  await execFileAsync(process.execPath, [
    BACKFILL_SCRIPT,
    "--family",
    "discord",
    "--spec",
    "openclaw@2026.5.16",
    "--version",
    "2026.5.16",
    "--sample-paths",
    path.join(workspace, "samples.tsv"),
  ], { cwd: workspace });

  const [updated] = (await fs.readFile(path.join(workspace, "data/channels/discord/2026.5.16.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(updated.rtt.p50Ms, 5000);
  assert.equal(updated.rtt.p95Ms, 7000);
  assert.deepEqual(updated.resources.measurement, {
    kind: "process-max-rss",
    scope: "qa-command",
    command: "pnpm openclaw qa discord",
  });
  assert.deepEqual(updated.resources.maxRssKbSamples, [204800, 307200]);
  assert.equal(updated.resources.maxRssKb.p50, 204800);
  assert.equal(updated.resources.maxRssKb.max, 307200);
});
