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

function releaseRow(version, status = "pass") {
  return {
    package: { spec: `openclaw@${version}`, version },
    run: {
      id: `telegram-${version}`,
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      durationMs: 2000,
      status,
    },
    mode: { providerMode: "mock-openai", scenarios: ["channel-canary"] },
    rtt: { warmSamples: [1000, 2000], p50Ms: 1000, p95Ms: 2000 },
  };
}

async function writeFakeNpm(workspace, versions) {
  const binDir = path.join(workspace, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  await fs.writeFile(
    npmPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2).join(' ');",
      "if (args !== 'view openclaw versions --json') {",
      "  console.error(`unexpected npm args: ${args}`);",
      "  process.exit(1);",
      "}",
      `process.stdout.write(${JSON.stringify(JSON.stringify(versions))});`,
      "",
    ].join("\n"),
  );
  await fs.chmod(npmPath, 0o755);
  return binDir;
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

test("requeues failed Telegram release rows", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    releaseRow("2026.5.12"),
    releaseRow("2026.5.16-beta.5", "fail"),
    releaseRow("2026.5.16-beta.6", "fail"),
  ]);
  const binDir = await writeFakeNpm(workspace, [
    "2026.5.12",
    "2026.5.16-beta.5",
    "2026.5.16-beta.6",
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    },
  });

  const outputs = parseOutputs(stdout);
  assert.equal(outputs.count, "2");
  assert.equal(outputs.reason, "new-release-versions");
  assert.equal(outputs.versions, "2026.5.16-beta.5 2026.5.16-beta.6");
});

test("skips registered Telegram release gaps", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    releaseRow("2026.6.11"),
  ]);
  const binDir = await writeFakeNpm(workspace, [
    "2026.6.11",
    "2026.7.1-beta.4",
    "2026.7.1-beta.5",
  ]);

  const { stderr, stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    },
  });

  const outputs = parseOutputs(stdout);
  assert.equal(outputs.count, "1");
  assert.equal(outputs.versions, "2026.7.1-beta.5");
  assert.match(
    stderr,
    /Skipping telegram openclaw@2026\.7\.1-beta\.4: published package omits @openclaw\/ai/u,
  );
});
