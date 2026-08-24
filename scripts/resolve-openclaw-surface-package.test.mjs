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
const RESOLVE_SCRIPT = path.join(REPO_ROOT, "scripts/resolve-openclaw-surface-package.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-surface-resolve-test-"));
}

async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function row(version, surface = "control-ui", status = "pass") {
  const label = surface === "control-ui" ? "Control UI" : "RPC";
  return {
    surface: { id: surface, label, scenario: `${surface}-canary` },
    package: { spec: `openclaw@${version}`, version },
    run: { id: `${surface}-${version}`, startedAt: "2026-05-16T00:00:00.000Z", status },
    rtt: { warmSamples: [1000], p50Ms: 1000, p95Ms: 1000 },
  };
}

function parseOutputs(stdout) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );
}

test("queues explicit Control UI release versions", async () => {
  const workspace = await makeWorkspace();

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSIONS: "2026.6.1-beta.3",
    },
  });

  const outputs = parseOutputs(stdout);
  const matrix = JSON.parse(outputs.matrix);
  assert.equal(outputs.should_run, "true");
  assert.equal(outputs.reason, "explicit-surface-release-versions");
  assert.deepEqual(matrix, [
    {
      label: "Control UI",
      scenario: "control-ui-qa-channel-image-roundtrip",
      spec: "openclaw@2026.6.1-beta.3",
      surface: "control-ui",
      tag: "v2026.6.1-beta.3",
      version: "2026.6.1-beta.3",
    },
  ]);
});

test("queues explicit surface release versions even when already measured", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.6.1-beta.3.jsonl"), [
    row("2026.6.1-beta.3"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSIONS: "2026.6.1-beta.3",
    },
  });

  const outputs = parseOutputs(stdout);
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.surface}:${entry.version}`), [
    "control-ui:2026.6.1-beta.3",
  ]);
});

test("auto-requeues failed surface release versions", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.6.1-beta.3.jsonl"), [
    row("2026.6.1-beta.3", "control-ui", "fail"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3 2026.6.1",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSION_LIMIT: "2",
    },
  });

  const outputs = parseOutputs(stdout);
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.surface}:${entry.version}`), [
    "control-ui:2026.6.1",
    "control-ui:2026.6.1-beta.3",
  ]);
});

test("prioritizes unattempted surface gaps before failed retries", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.6.1-beta.3.jsonl"), [
    {
      package: { spec: "openclaw@2026.6.1-beta.3", version: "2026.6.1-beta.3" },
      run: { id: "telegram-2026.6.1-beta.3", status: "pass" },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.6.1-beta.4.jsonl"), [
    {
      package: { spec: "openclaw@2026.6.1-beta.4", version: "2026.6.1-beta.4" },
      run: { id: "telegram-2026.6.1-beta.4", status: "pass" },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.6.1-beta.3.jsonl"), [
    row("2026.6.1-beta.3", "control-ui", "fail"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3 2026.6.1-beta.4",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSION_LIMIT: "2",
    },
  });

  const outputs = parseOutputs(stdout);
  assert.deepEqual(
    JSON.parse(outputs.matrix).map((entry) => `${entry.surface}:${entry.version}`),
    ["control-ui:2026.6.1-beta.4", "control-ui:2026.6.1-beta.3"],
  );
});

test("queues historical surface gaps from the Telegram release baseline", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.6.1-beta.3.jsonl"), [
    {
      package: { spec: "openclaw@2026.6.1-beta.3", version: "2026.6.1-beta.3" },
      run: { id: "telegram-2026.6.1-beta.3", status: "pass" },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channels/telegram/2026.6.1-beta.4.jsonl"), [
    {
      package: { spec: "openclaw@2026.6.1-beta.4", version: "2026.6.1-beta.4" },
      run: { id: "telegram-2026.6.1-beta.4", status: "pass" },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.6.1-beta.4.jsonl"), [
    row("2026.6.1-beta.4"),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3 2026.6.1-beta.4",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSION_LIMIT: "1",
    },
  });

  const outputs = parseOutputs(stdout);
  const matrix = JSON.parse(outputs.matrix);
  assert.deepEqual(matrix.map((entry) => `${entry.surface}:${entry.version}`), [
    "control-ui:2026.6.1-beta.3",
  ]);
});

test("rejects release surfaces without a native release measurer", async () => {
  const workspace = await makeWorkspace();

  await assert.rejects(execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.6.1-beta.3",
      INPUT_SURFACES: "rpc",
    },
  }), /Surface rpc is not supported by release surface RTT/u);
});

test("queues explicit numeric post releases for release surfaces", async () => {
  const workspace = await makeWorkspace();

  const { stdout } = await execFileAsync(process.execPath, [RESOLVE_SCRIPT], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      INPUT_AVAILABLE_VERSIONS: "2026.7.1-2",
      INPUT_SURFACES: "control-ui",
      INPUT_VERSIONS: "2026.7.1-2",
    },
  });

  const outputs = parseOutputs(stdout);
  assert.deepEqual(JSON.parse(outputs.matrix).map((entry) => entry.version), [
    "2026.7.1-2",
  ]);
});
