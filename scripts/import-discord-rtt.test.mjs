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

  await assert.rejects(fs.stat(path.join(workspace, "data/discord-rtt.jsonl")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(workspace, "discord-runs")), { code: "ENOENT" });
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
  await fs.writeFile(path.join(sampleDir, "resource-metrics.env"), "max_rss_kb=204800\nelapsed_seconds=12.5\n");
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

  const [row] = (await fs.readFile(path.join(workspace, "data/discord-rtt.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(row.rtt.p50Ms, 5250);
  assert.equal(row.rtt.p95Ms, 5250);
  assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
  assert.equal(row.resources.maxRssKb.p50, 204800);
  assert.equal(row.resources.elapsedSeconds.p50, 12.5);
});
