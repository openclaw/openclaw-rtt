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
const UPDATE_README_SCRIPT = path.join(REPO_ROOT, "scripts/update-readme.mjs");

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-readme-test-"));
}

async function writeJsonl(pathname, rows) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("renders channel RTT and RSS metrics in the README channel table", async () => {
  const workspace = await makeWorkspace();
  await fs.writeFile(
    path.join(workspace, "README.md"),
    [
      "# OpenClaw RTT",
      "",
      "<!-- latest-main:start -->",
      "old main",
      "<!-- latest-main:end -->",
      "",
      "<!-- release-sweep:start -->",
      "old release",
      "<!-- release-sweep:end -->",
      "",
      "<!-- discord-release-sweep:start -->",
      "old discord release",
      "<!-- discord-release-sweep:end -->",
      "",
      "<!-- channel-rtt:start -->",
      "old channel",
      "<!-- channel-rtt:end -->",
      "",
    ].join("\n"),
  );
  await writeJsonl(path.join(workspace, "data/channel-rtt/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      package: { spec: "openclaw@main", version: "2026.5.16+abcdef1234" },
      run: {
        id: "slack-run",
        startedAt: "2026-05-16T00:00:00.000Z",
        finishedAt: "2026-05-16T00:00:02.000Z",
        status: "pass",
      },
      rtt: { warmSamples: [300, 400], p50Ms: 300, p95Ms: 400 },
      resources: {
        maxRssKbSamples: [204800, 307200],
        maxRssKb: { p50: 204800, p95: 307200, max: 307200 },
      },
    },
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  assert.match(readme, /\| Channel \| Scenario \| Version\/ref \| Result \| Samples \| RTT p50 \| RTT p95 \| RSS p50 \| RSS max \| Updated \|/u);
  assert.match(
    readme,
    /\| Slack \| `slack-canary` \| `2026\.5\.16\+abcdef1234` \| Pass \| 2 \| `300ms` \| `400ms` \| `200MB` \| `300MB` \| `2026-05-16T00:00:00\.000Z` \|/u,
  );
});
