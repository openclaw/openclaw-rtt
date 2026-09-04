import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { OPENCLAW_QA_HARNESS_SHA } from "./openclaw-qa-harness.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVE_SCRIPT = path.join(REPO_ROOT, "scripts/resolve-openclaw-channel-package.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-channel-resolve-test-"));
}

async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function row(version, channel, status = "pass") {
  return {
    ...(channel ? { channel: { id: channel, label: channel, scenario: `${channel}-canary` } } : {}),
    package: { spec: `openclaw@${version}`, version },
    run: { id: `${channel ?? "telegram"}-${version}`, startedAt: "2026-05-16T00:00:00.000Z", status },
    rtt: { warmSamples: [1000], p50Ms: 1000, p95Ms: 1000 },
  };
}

test("queues explicit Slack and WhatsApp release versions", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.3",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSIONS: "2026.5.16-beta.3",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  const matrix = JSON.parse(outputs.matrix);
  assert.equal(outputs.should_run, "true");
  assert.equal(matrix[0].qa_ref, OPENCLAW_QA_HARNESS_SHA);
  assert.deepEqual(matrix.map((entry) => `${entry.channel}:${entry.version}`), [
    "slack:2026.5.16-beta.3",
    "whatsapp:2026.5.16-beta.3",
  ]);
});

test("queues explicit channel release versions even when already measured", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3", "slack"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.3",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSIONS: "2026.5.16-beta.3",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.channel}:${entry.version}`), [
    "slack:2026.5.16-beta.3",
    "whatsapp:2026.5.16-beta.3",
  ]);
});

test("scheduled channel release discovery keeps four versions per channel", async () => {
  const workspace = await makeWorkspace();
  const versions = [
    "2026.5.16-beta.1",
    "2026.5.16-beta.2",
    "2026.5.16-beta.3",
    "2026.5.16-beta.4",
    "2026.5.16-beta.5",
  ];

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: versions.join(" "),
      INPUT_CHANNELS: "slack",
      INPUT_VERSIONS: "",
      INPUT_VERSION_LIMIT: "",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  assert.deepEqual(
    JSON.parse(outputs.matrix).map((entry) => entry.version),
    versions.slice(0, 4),
  );
});

test("auto-requeues failed channel release versions", async () => {
  const workspace = await makeWorkspace();
  for (const version of ["2026.5.16-beta.6", "2026.5.16-beta.7"]) {
    await writeJsonl(path.join(workspace, `data/channels/telegram/${version}.jsonl`), [
      row(version),
    ]);
    await writeJsonl(path.join(workspace, `data/channels/whatsapp/${version}.jsonl`), [
      row(version, "whatsapp"),
    ]);
  }
  await writeJsonl(path.join(workspace, "data/channels/slack/2026.5.16-beta.6.jsonl"), [
    row("2026.5.16-beta.6", "slack", "fail"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack/2026.5.16-beta.7.jsonl"), [
    row("2026.5.16-beta.7", "slack"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.6 2026.5.16-beta.7",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSION_LIMIT: "2",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.channel}:${entry.version}`), [
    "slack:2026.5.16-beta.6",
  ]);
});

test("runs unattempted channel gaps before failed retry batches", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.4.jsonl"), [
    row("2026.5.16-beta.4"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3", "slack", "fail"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.3 2026.5.16-beta.4",
      INPUT_CHANNELS: "slack",
      INPUT_VERSION_LIMIT: "2",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  assert.deepEqual(
    JSON.parse(outputs.matrix).map((entry) => `${entry.channel}:${entry.version}`),
    ["slack:2026.5.16-beta.4"],
  );
});

test("queues historical channel gaps from the Telegram release baseline", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.3.jsonl"), [
    row("2026.5.16-beta.3"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.16-beta.4.jsonl"), [
    row("2026.5.16-beta.4"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack/2026.5.16-beta.4.jsonl"), [
    row("2026.5.16-beta.4", "slack"),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/whatsapp/2026.5.16-beta.4.jsonl"), [
    row("2026.5.16-beta.4", "whatsapp"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.3 2026.5.16-beta.4",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSION_LIMIT: "1",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.channel}:${entry.version}`), [
    "slack:2026.5.16-beta.3",
    "whatsapp:2026.5.16-beta.3",
  ]);
});

test("does not auto-queue releases before the channel coverage floor", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.4.22.jsonl"), [
    row("2026.4.22"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.4.22",
      INPUT_CHANNELS: "slack whatsapp",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  assert.equal(outputs.should_run, "false");
  assert.deepEqual(JSON.parse(outputs.matrix), []);
});

test("skips proven historical channel release gaps", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.5.2.jsonl"), [
    row("2026.5.2"),
  ]);

  const { stderr, stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.5.2 2026.5.16-beta.3",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSIONS: "2026.5.2 2026.5.16-beta.3",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  const matrix = JSON.parse(outputs.matrix);
  assert.match(stderr, /Skipping slack openclaw@2026\.5\.2/u);
  assert.match(stderr, /Skipping whatsapp openclaw@2026\.5\.2/u);
  assert.deepEqual(matrix.map((entry) => `${entry.channel}:${entry.version}`), [
    "slack:2026.5.16-beta.3",
    "whatsapp:2026.5.16-beta.3",
  ]);
});

test("queues explicit numeric post releases for sibling channels", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.7.1-2.jsonl"), [
    row("2026.7.1-2"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.7.1-2",
      INPUT_CHANNELS: "slack whatsapp",
      INPUT_VERSIONS: "2026.7.1-2",
    },
  });

  const outputs = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
  assert.deepEqual(
    JSON.parse(outputs.matrix).map((entry) => `${entry.channel}:${entry.version}`),
    ["slack:2026.7.1-2", "whatsapp:2026.7.1-2"],
  );
});
