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
const RESOLVE_SCRIPT = path.join(REPO_ROOT, "scripts/resolve-openclaw-package.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-resolve-test-"));
}

async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function releaseRow(version) {
  return {
    package: { spec: `openclaw@${version}`, version },
    run: {
      id: `telegram-${version}`,
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      durationMs: 2000,
      status: "pass",
    },
    mode: { providerMode: "mock-openai", scenarios: ["telegram-mentioned-message-reply"] },
    rtt: { warmSamples: [1000, 2000], p50Ms: 1000, p95Ms: 2000 },
  };
}

function withResources(row) {
  return {
    ...row,
    resources: {
      maxRssKbSamples: [204800],
      elapsedSecondsSamples: [10],
      maxRssKb: { avg: 204800, p50: 204800, p95: 204800, max: 204800 },
      elapsedSeconds: { avg: 10, p50: 10, p95: 10, max: 10 },
    },
  };
}

function parseOutputs(stdout) {
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

test("queues Telegram release rows missing RSS for backfill", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    releaseRow("2026.5.12"),
    withResources(releaseRow("2026.5.16")),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_RSS_BACKFILL: "true",
      INPUT_RSS_BACKFILL_LIMIT: "1",
    },
  });

  const outputs = parseOutputs(stdout);
  assert.equal(outputs.count, "1");
  assert.equal(outputs.rss_backfill, "true");
  assert.equal(outputs.reason, "release-rss-backfill");
  assert.equal(outputs.versions, "2026.5.12");
});

test("skips selected Telegram release RSS backfill versions", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    releaseRow("2026.5.12"),
    releaseRow("2026.5.14-beta.1"),
    releaseRow("2026.5.6"),
    withResources(releaseRow("2026.5.16")),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_RSS_BACKFILL: "true",
      INPUT_RSS_BACKFILL_LIMIT: "5",
      INPUT_RSS_BACKFILL_SKIP_VERSIONS: "2026.5.14-beta.1, 2026.5.6",
    },
  });

  const outputs = parseOutputs(stdout);
  assert.equal(outputs.count, "1");
  assert.equal(outputs.versions, "2026.5.12");
});
