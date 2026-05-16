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
const RESOLVE_SCRIPT = path.join(REPO_ROOT, "scripts/resolve-openclaw-discord-package.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-discord-resolve-test-"));
}

async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function releaseRow(version, source) {
  return {
    package: { spec: `openclaw@${version}`, version },
    run: {
      id: `${source}-${version}`,
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      status: "pass",
    },
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

test("queues missing Discord releases from the Telegram baseline", async () => {
  const workspace = await makeWorkspace();
  await writeJsonl(path.join(workspace, "data/rtt.jsonl"), [
    releaseRow("2026.4.15", "telegram"),
    releaseRow("2026.5.12", "telegram"),
    releaseRow("2026.5.16-beta.2", "telegram"),
  ]);
  await writeJsonl(path.join(workspace, "data/discord-rtt.jsonl"), [
    releaseRow("2026.5.16-beta.2", "discord"),
  ]);
  const binDir = await writeFakeNpm(workspace, [
    "2026.4.15",
    "2026.5.10-beta.1",
    "2026.5.12",
    "2026.5.16-beta.2",
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
  assert.equal(outputs.count, "1");
  assert.equal(outputs.missing_baseline_count, "1");
  assert.equal(outputs.unsupported_baseline_count, "1");
  assert.equal(outputs.reason, "missing-discord-release-versions");
  assert.equal(outputs.versions, "2026.5.12");
  assert.deepEqual(JSON.parse(outputs.matrix).map((pkg) => pkg.version), ["2026.5.12"]);
});
