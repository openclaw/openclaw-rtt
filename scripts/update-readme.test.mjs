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

async function writeReadme(workspace) {
  await fs.writeFile(
    path.join(workspace, "README.md"),
    [
      "# OpenClaw RTT",
      "",
      "<!-- latest-main:start -->",
      "old main",
      "<!-- latest-main:end -->",
      "",
      "<!-- release-coverage:start -->",
      "old release coverage",
      "<!-- release-coverage:end -->",
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
}

function rttRow(overrides) {
  const base = {
    package: { spec: "openclaw@main", version: "2026.5.16+abcdef1234" },
    run: {
      id: "run",
      startedAt: "2026-05-16T00:00:00.000Z",
      finishedAt: "2026-05-16T00:00:02.000Z",
      status: "pass",
    },
    rtt: { warmSamples: [300, 400], p50Ms: 300, p95Ms: 400 },
  };
  return {
    ...base,
    ...overrides,
    package: { ...base.package, ...overrides.package },
    run: { ...base.run, ...overrides.run },
    rtt: { ...base.rtt, ...overrides.rtt },
  };
}

test("renders channel RTT and RSS metrics in the README channel table", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/channel-rtt/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({ run: { id: "slack-run", startedAt: "2026-05-16T00:00:00.000Z", status: "pass" } }),
      polling: {
        attemptSamples: [1, 2],
        retryCount: 1,
        maxAttempts: 2,
      },
      resources: {
        maxRssKbSamples: [204800, 307200],
        maxRssKb: { p50: 204800, p95: 307200, max: 307200 },
      },
    },
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const channelSection = readme.slice(
    readme.indexOf("<!-- channel-rtt:start -->"),
    readme.indexOf("<!-- channel-rtt:end -->"),
  );
  assert.match(channelSection, /\| Channel \| Version\/ref \| Result \| Samples \| RTT p50 \| RTT p95 \| RSS p50 \| RSS max \| Updated \|/u);
  assert.match(
    channelSection,
    /\| Slack \| `2026\.5\.16\+abcdef1234` \| Pass \| 2 \| `300ms` \| `400ms` \| `200MB` \| `300MB` \| `2026-05-16T00:00:00\.000Z` \|/u,
  );
  assert.doesNotMatch(channelSection, /\| Channel \| Scenario \|/u);
  assert.doesNotMatch(channelSection, /\| Channel \|.*\| Retries \|/u);
});

test("renders latest main dashboard rows for Telegram, Discord, and live channels", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/rtt.jsonl"), [
    rttRow({
      package: { spec: "openclaw@main", version: "2026.5.16+telegram1234" },
      run: { id: "telegram-run", startedAt: "2026-05-16T00:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [1000, 2000], p50Ms: 1000, p95Ms: 2000 },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/discord-rtt.jsonl"), [
    rttRow({
      package: { spec: "openclaw@main", version: "2026.5.16+discord1234" },
      run: { id: "discord-run", startedAt: "2026-05-16T00:01:00.000Z", status: "pass" },
      rtt: { warmSamples: [6000, 7000], p50Ms: 6000, p95Ms: 7000 },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channel-rtt/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.16+slack1234" },
        run: { id: "slack-run", startedAt: "2026-05-16T00:02:00.000Z", status: "pass" },
        rtt: { warmSamples: [4000, 5000], p50Ms: 4000, p95Ms: 5000 },
      }),
      polling: { retryCount: 0 },
      resources: { maxRssKb: { p50: 204800, max: 307200 } },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channel-rtt/whatsapp.jsonl"), [
    {
      channel: { id: "whatsapp", label: "WhatsApp", scenario: "whatsapp-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.16+whatsapp1234" },
        run: { id: "whatsapp-run", startedAt: "2026-05-16T00:03:00.000Z", status: "pass" },
        rtt: { warmSamples: [8000, 9000], p50Ms: 8000, p95Ms: 9000 },
      }),
      polling: { retryCount: 1 },
      resources: { maxRssKb: { p50: 409600, max: 512000 } },
    },
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  assert.match(readme, /Latest imported channel run: `2026-05-16T00:03:00\.000Z`/u);
  assert.match(readme, /\| Channel \| Scope \| Scenario \| Version\/ref \| Result \| Samples \| Retries \| RTT p50 \| RTT p95 \| RSS p50 \| RSS max \| Updated \|/u);
  assert.match(readme, /\| Telegram \| Main \| `telegram-mentioned-message-reply` \| `2026\.5\.16\+telegram1234` \| Pass \| 2 \| - \| `1,000ms` \| `2,000ms` \| - \| - \| `2026-05-16T00:00:00\.000Z` \|/u);
  assert.match(readme, /\| Discord \| Main \| `discord-canary` \| `2026\.5\.16\+discord1234` \| Pass \| 2 \| - \| `6,000ms` \| `7,000ms` \| - \| - \| `2026-05-16T00:01:00\.000Z` \|/u);
  assert.match(readme, /\| Slack \| Main \| `slack-canary` \| `2026\.5\.16\+slack1234` \| Pass \| 2 \| 0 \| `4,000ms` \| `5,000ms` \| `200MB` \| `300MB` \| `2026-05-16T00:02:00\.000Z` \|/u);
  assert.match(readme, /\| WhatsApp \| Main \| `whatsapp-canary` \| `2026\.5\.16\+whatsapp1234` \| Pass \| 2 \| 1 \| `8,000ms` \| `9,000ms` \| `400MB` \| `500MB` \| `2026-05-16T00:03:00\.000Z` \|/u);
});

test("renders release coverage gaps across Telegram and Discord", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/rtt.jsonl"), [
    rttRow({
      package: { spec: "openclaw@2026.4.15", version: "2026.4.15" },
      run: { id: "telegram-2026.4.15", startedAt: "2026-05-15T00:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [900, 1900], p50Ms: 900, p95Ms: 1900 },
    }),
    rttRow({
      package: { spec: "openclaw@2026.5.12", version: "2026.5.12" },
      run: { id: "telegram-2026.5.12", startedAt: "2026-05-16T00:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [1000, 2000], p50Ms: 1000, p95Ms: 2000 },
    }),
    rttRow({
      package: { spec: "openclaw@2026.5.3", version: "2026.5.3" },
      run: { id: "telegram-2026.5.3", startedAt: "2026-05-15T01:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [950, 1950], p50Ms: 950, p95Ms: 1950 },
    }),
    rttRow({
      package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
      run: { id: "telegram-2026.5.16-beta.1", startedAt: "2026-05-16T00:02:00.000Z", status: "pass" },
      rtt: { warmSamples: [1100, 2100], p50Ms: 1100, p95Ms: 2100 },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/discord-rtt.jsonl"), [
    rttRow({
      package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
      run: { id: "discord-2026.5.16-beta.1", startedAt: "2026-05-16T00:03:00.000Z", status: "pass" },
      rtt: { warmSamples: [6000, 7000], p50Ms: 6000, p95Ms: 7000 },
    }),
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const coverageSection = readme.slice(
    readme.indexOf("<!-- release-coverage:start -->"),
    readme.indexOf("<!-- release-coverage:end -->"),
  );
  assert.match(
    coverageSection,
    /Discord release gap: 1 version missing; 2 Telegram versions are not supported by the Discord release canary\./u,
  );
  assert.match(coverageSection, /\| Version \| Telegram \| Discord \| Updated \|/u);
  assert.match(
    coverageSection,
    /\| `2026\.5\.16-beta\.1` \| Pass · 2 samples · `1,100ms` \/ `2,100ms` \| Pass · 2 samples · `6,000ms` \/ `7,000ms` \| `2026-05-16T00:03:00\.000Z` \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.12` \| Pass · 2 samples · `1,000ms` \/ `2,000ms` \| Missing \| `2026-05-16T00:00:00\.000Z` \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.4\.15` \| Pass · 2 samples · `900ms` \/ `1,900ms` \| Not supported \| `2026-05-15T00:00:00\.000Z` \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.3` \| Pass · 2 samples · `950ms` \/ `1,950ms` \| Not supported \| `2026-05-15T01:00:00\.000Z` \|/u,
  );
});
