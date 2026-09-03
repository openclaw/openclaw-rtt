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
      "<!-- surface-latest:start -->",
      "old surface",
      "<!-- surface-latest:end -->",
      "",
      "<!-- release-coverage:start -->",
      "old release coverage",
      "<!-- release-coverage:end -->",
      "",
      "<!-- surface-release-coverage:start -->",
      "old surface release coverage",
      "<!-- surface-release-coverage:end -->",
      "",
      "<!-- release-sweep:start -->",
      "old release",
      "<!-- release-sweep:end -->",
      "",
      "<!-- discord-release-sweep:start -->",
      "old discord release",
      "<!-- discord-release-sweep:end -->",
      "",
      "<!-- slack-release-sweep:start -->",
      "old slack release",
      "<!-- slack-release-sweep:end -->",
      "",
      "<!-- whatsapp-release-sweep:start -->",
      "old whatsapp release",
      "<!-- whatsapp-release-sweep:end -->",
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

test("merges channel RTT details into the dashboard", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/channels/slack.jsonl"), [
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
  assert.doesNotMatch(readme, /<!-- channel-rtt:start -->/u);
  assert.doesNotMatch(readme, /Merged into the Dashboard table above\./u);

  const dashboardSection = readme.slice(
    readme.indexOf("<!-- latest-main:start -->"),
    readme.indexOf("<!-- latest-main:end -->"),
  );
  assert.match(
    dashboardSection,
    /Latest imported channel run: `2026-05-16T00:00:00\.000Z` · latest `2026\.5\.16` \/ `abcdef1234`/u,
  );
  assert.doesNotMatch(dashboardSection, /Version\/ref:/u);
  assert.match(
    dashboardSection,
    /\| Slack \| `300ms` \| `400ms` \| `200MB` \| `300MB` \|/u,
  );
});

test("renders latest main dashboard rows for Telegram, Discord, and live channels", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    {
      channel: { id: "telegram", label: "Telegram", scenario: "channel-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.16+telegram1234" },
        run: { id: "telegram-run", startedAt: "2026-05-16T00:00:00.000Z", status: "pass" },
        rtt: { warmSamples: [1000, 2000], p50Ms: 1000, p95Ms: 2000 },
        resources: { maxRssKb: { p50: 153600, p95: 204800, max: 204800 } },
      }),
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channels/discord.jsonl"), [
    rttRow({
      package: { spec: "openclaw@main", version: "2026.5.16+discord1234" },
      run: { id: "discord-run", startedAt: "2026-05-16T00:01:00.000Z", status: "pass" },
      rtt: { warmSamples: [6000, 7000], p50Ms: 6000, p95Ms: 7000 },
      resources: { maxRssKb: { p50: 256000, p95: 358400, max: 358400 } },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.16+slack1234" },
        run: { id: "slack-run", startedAt: "2026-05-16T00:02:00.000Z", status: "pass" },
        rtt: { warmSamples: [4000, 5000], p50Ms: 4000, p95Ms: 5000 },
      }),
      polling: { retryCount: 0 },
      resources: { maxRssKb: { p50: 204800, p95: 307200, max: 307200 } },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channels/whatsapp.jsonl"), [
    {
      channel: { id: "whatsapp", label: "WhatsApp", scenario: "whatsapp-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.16+whatsapp1234" },
        run: { id: "whatsapp-run", startedAt: "2026-05-16T00:03:00.000Z", status: "pass" },
        rtt: { warmSamples: [8000, 9000], p50Ms: 8000, p95Ms: 9000 },
      }),
      polling: { retryCount: 1 },
      resources: { maxRssKb: { p50: 409600, p95: 512000, max: 512000 } },
    },
  ]);
  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  assert.match(readme, /Latest imported channel run: `2026-05-16T00:03:00\.000Z` · latest `2026\.5\.16` \/ `whatsapp1234`/u);
  assert.doesNotMatch(readme, /Version\/ref:/u);
  assert.match(readme, /\| Channel \| RTT p50 \| RTT p95 \| RSS p50 \| RSS p95 \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Result \|/u);
  assert.doesNotMatch(readme, /\| Channel \| Scope \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Scenario \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Version\/ref \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Samples \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Retries \|/u);
  assert.doesNotMatch(readme, /\| Channel \|.*\| Updated \|/u);
  assert.match(readme, /\| Telegram \| `1,000ms` \| `2,000ms` \| `150MB` \| `200MB` \|/u);
  assert.match(readme, /\| Discord \| `6,000ms` \| `7,000ms` \| `250MB` \| `350MB` \|/u);
  assert.match(readme, /\| Slack \| `4,000ms` \| `5,000ms` \| `200MB` \| `300MB` \|/u);
  assert.match(readme, /\| WhatsApp \| `8,000ms` \| `9,000ms` \| `400MB` \| `500MB` \|/u);
});

test("keeps latest passing main rows visible when a newer run fails", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    rttRow({
      package: { spec: "openclaw@main", version: "2026.5.17+pass123456" },
      run: { id: "telegram-pass", startedAt: "2026-05-17T01:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [1100, 2100], p50Ms: 1100, p95Ms: 2100 },
    }),
    rttRow({
      package: { spec: "openclaw@main", version: "2026.5.17+fail123456" },
      run: { id: "telegram-fail", startedAt: "2026-05-17T07:00:00.000Z", status: "fail" },
      rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.17+slackpass" },
        run: { id: "slack-pass", startedAt: "2026-05-17T02:00:00.000Z", status: "pass" },
        rtt: { warmSamples: [4000, 5000], p50Ms: 4000, p95Ms: 5000 },
      }),
      resources: { maxRssKb: { p50: 409600, p95: 512000, max: 512000 } },
    },
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({
        package: { spec: "openclaw@main", version: "2026.5.17+slackfail" },
        run: { id: "slack-fail", startedAt: "2026-05-17T08:00:00.000Z", status: "fail" },
        rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
      }),
    },
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const dashboardSection = readme.slice(
    readme.indexOf("<!-- latest-main:start -->"),
    readme.indexOf("<!-- latest-main:end -->"),
  );
  assert.match(dashboardSection, /\| Telegram \| `1,100ms` \| `2,100ms` \| n\/a \| n\/a \|/u);
  assert.match(dashboardSection, /\| Discord \| n\/a \| n\/a \| n\/a \| n\/a \|/u);
  assert.match(dashboardSection, /\| Slack \| `4,000ms` \| `5,000ms` \| `400MB` \| `500MB` \|/u);
  assert.match(
    dashboardSection,
    /stale: latest failed; showing last pass \(failed\)/u,
  );
});

test("renders release coverage across channels and surfaces", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
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
  await writeJsonl(path.join(workspace, "data/channels/discord.jsonl"), [
    rttRow({
      package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
      run: { id: "discord-2026.5.16-beta.1", startedAt: "2026-05-16T00:03:00.000Z", status: "pass" },
      rtt: { warmSamples: [6000, 7000], p50Ms: 6000, p95Ms: 7000 },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/slack.jsonl"), [
    {
      channel: { id: "slack", label: "Slack", scenario: "slack-canary" },
      ...rttRow({
        package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
        run: { id: "slack-2026.5.16-beta.1", startedAt: "2026-05-16T00:04:00.000Z", status: "pass" },
        rtt: { warmSamples: [3000, 4000], p50Ms: 3000, p95Ms: 4000 },
      }),
    },
  ]);
  await writeJsonl(path.join(workspace, "data/channels/whatsapp.jsonl"), [
    {
      channel: { id: "whatsapp", label: "WhatsApp", scenario: "whatsapp-canary" },
      ...rttRow({
        package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
        run: { id: "whatsapp-2026.5.16-beta.1", startedAt: "2026-05-16T00:05:00.000Z", status: "pass" },
        rtt: { warmSamples: [8000, 9000], p50Ms: 8000, p95Ms: 9000 },
      }),
      resources: { maxRssKb: { p50: 409600, p95: 512000, max: 512000 } },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/rpc/2026.5.16-beta.1.jsonl"), [
    {
      surface: { id: "rpc", label: "RPC", scenario: "rpc-gateway-smoke" },
      ...rttRow({
        package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
        run: { id: "rpc-native-2026.5.16-beta.1", startedAt: "2026-05-16T00:01:30.000Z", status: "pass" },
        rtt: { warmSamples: [80, 100], p50Ms: 80, p95Ms: 100 },
      }),
      mode: { providerMode: "gateway-rpc", source: "surface-import" },
    },
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.5.16-beta.1.jsonl"), [
    {
      surface: { id: "control-ui", label: "Control UI", scenario: "control-ui-qa-channel-image-roundtrip" },
      ...rttRow({
        package: { spec: "openclaw@2026.5.16-beta.1", version: "2026.5.16-beta.1" },
        run: { id: "control-ui-2026.5.16-beta.1", startedAt: "2026-05-16T00:04:45.000Z", status: "pass" },
        rtt: { warmSamples: [700, 900], p50Ms: 700, p95Ms: 900 },
      }),
    },
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const coverageSection = readme.slice(
    readme.indexOf("<!-- release-coverage:start -->"),
    readme.indexOf("<!-- release-coverage:end -->"),
  );
  assert.doesNotMatch(coverageSection, /Discord release gap:/u);
  assert.match(coverageSection, /Latest imported release coverage run: `2026-05-16T00:05:00\.000Z`/u);
  assert.match(coverageSection, /\| Version \| p50 σ \| Telegram \| Discord \| Slack \| WhatsApp \| RPC \| Control UI \|/u);
  assert.doesNotMatch(coverageSection, /\| Version \| Telegram \| Discord \| Updated \|/u);
  assert.match(
    coverageSection,
    /\| `2026\.5\.16-beta\.1` \| `2,924ms` \| `1,100ms` \| `6,000ms` \| `3,000ms` \| `8,000ms` \| `80ms` \| `700ms` \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.12` \| n\/a \| `1,000ms` \| - \| - \| - \| n\/a \| n\/a \|/u,
  );
  assert.doesNotMatch(coverageSection, /2026\.4\.15/u);
  assert.match(
    coverageSection,
    /\| `2026\.5\.3` \| n\/a \| `950ms` \| n\/a \| - \| n\/a \| n\/a \| n\/a \|/u,
  );

  const telegramSection = readme.slice(
    readme.indexOf("<!-- release-sweep:start -->"),
    readme.indexOf("<!-- release-sweep:end -->"),
  );
  assert.match(telegramSection, /\| npm version \| RTT p50 \| RTT p95 \| RSS p50 \| RSS p95 \| Status \|/u);
  assert.doesNotMatch(telegramSection, /\| npm version \|.*\| Result \|/u);
  assert.doesNotMatch(telegramSection, /\| npm version \|.*\| Samples \|/u);
  assert.doesNotMatch(telegramSection, /\| npm version \|.*\| Updated \|/u);
  assert.match(telegramSection, /\| `2026\.4\.15` \| `900ms` \| `1,900ms` \| n\/a \| n\/a \|/u);

  const discordSection = readme.slice(
    readme.indexOf("<!-- discord-release-sweep:start -->"),
    readme.indexOf("<!-- discord-release-sweep:end -->"),
  );
  assert.match(discordSection, /\| npm version \| RTT p50 \| RTT p95 \| RSS p50 \| RSS p95 \| Status \|/u);
  assert.doesNotMatch(discordSection, /\| npm version \|.*\| Result \|/u);
  assert.doesNotMatch(discordSection, /\| npm version \|.*\| Samples \|/u);
  assert.doesNotMatch(discordSection, /\| npm version \|.*\| Updated \|/u);
  assert.match(discordSection, /\| `2026\.5\.12` \| - \| - \| - \| - \| missing: no imported run \|/u);
  assert.doesNotMatch(discordSection, /2026\.4\.15/u);

  const slackSection = readme.slice(
    readme.indexOf("<!-- slack-release-sweep:start -->"),
    readme.indexOf("<!-- slack-release-sweep:end -->"),
  );
  assert.match(slackSection, /\| npm version \| RTT p50 \| RTT p95 \| RSS p50 \| RSS p95 \| Status \|/u);
  assert.doesNotMatch(slackSection, /\| npm version \|.*\| Result \|/u);
  assert.doesNotMatch(slackSection, /\| npm version \|.*\| Samples \|/u);
  assert.match(slackSection, /\| `2026\.5\.16-beta\.1` \| `3,000ms` \| `4,000ms` \| n\/a \| n\/a \| ok \|/u);
  assert.match(slackSection, /\| `2026\.5\.12` \| - \| - \| - \| - \| missing: no imported run \|/u);
  assert.match(slackSection, /\| `2026\.5\.3` \| - \| - \| - \| - \| missing: no imported run \|/u);
  assert.doesNotMatch(slackSection, /2026\.4\.15/u);

  const whatsappSection = readme.slice(
    readme.indexOf("<!-- whatsapp-release-sweep:start -->"),
    readme.indexOf("<!-- whatsapp-release-sweep:end -->"),
  );
  assert.match(whatsappSection, /\| npm version \| RTT p50 \| RTT p95 \| RSS p50 \| RSS p95 \| Status \|/u);
  assert.doesNotMatch(whatsappSection, /\| npm version \|.*\| Result \|/u);
  assert.doesNotMatch(whatsappSection, /\| npm version \|.*\| Samples \|/u);
  assert.match(whatsappSection, /\| `2026\.5\.16-beta\.1` \| `8,000ms` \| `9,000ms` \| `400MB` \| `500MB` \| ok \|/u);
  assert.match(whatsappSection, /\| `2026\.5\.12` \| - \| - \| - \| - \| missing: no imported run \|/u);
  assert.match(whatsappSection, /\| `2026\.5\.3` \| - \| - \| - \| - \| not supported: release predates the WhatsApp QA canary \|/u);
  assert.doesNotMatch(whatsappSection, /2026\.4\.15/u);

  const surfaceCoverageSection = readme.slice(
    readme.indexOf("<!-- surface-release-coverage:start -->"),
    readme.indexOf("<!-- surface-release-coverage:end -->"),
  );
  assert.match(surfaceCoverageSection, /\| `2026\.5\.16-beta\.1` \| `80ms` \| `700ms` \|/u);
});

test("marks pre-collection Control UI release surface cells as not applicable", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  const surfaceRow = (surface, version, p50Ms, startedAt) => {
    const label = surface === "control-ui" ? "Control UI" : "RPC";
    const scenario = surface === "control-ui" ? "control-ui-qa-channel-image-roundtrip" : "rpc-gateway-smoke";
    return {
      surface: { id: surface, label, scenario },
      ...rttRow({
        package: { spec: `openclaw@${version}`, version },
        run: { id: `${surface}-${version}`, startedAt, status: "pass" },
        rtt: { warmSamples: [p50Ms], p50Ms, p95Ms: p50Ms },
      }),
      mode: { source: "surface-import" },
    };
  };

  await writeJsonl(path.join(workspace, "data/surfaces/rpc/2026.6.1-beta.2.jsonl"), [
    surfaceRow("rpc", "2026.6.1-beta.2", 12, "2026-06-01T00:00:00.000Z"),
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/rpc/2026.6.1-beta.3.jsonl"), [
    surfaceRow("rpc", "2026.6.1-beta.3", 13, "2026-06-01T00:01:00.000Z"),
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/control-ui/2026.6.1-beta.3.jsonl"), [
    surfaceRow("control-ui", "2026.6.1-beta.3", 456, "2026-06-01T00:02:00.000Z"),
  ]);
  await writeJsonl(path.join(workspace, "data/surfaces/rpc/2026.6.1.jsonl"), [
    surfaceRow("rpc", "2026.6.1", 14, "2026-06-01T00:03:00.000Z"),
  ]);

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const coverageSection = readme.slice(
    readme.indexOf("<!-- release-coverage:start -->"),
    readme.indexOf("<!-- release-coverage:end -->"),
  );
  assert.match(
    coverageSection,
    /\| `2026\.6\.1` \| n\/a \| - \| - \| - \| - \| `14ms` \| - \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.6\.1-beta\.3` \| `222ms` \| - \| - \| - \| - \| `13ms` \| `456ms` \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.6\.1-beta\.2` \| n\/a \| - \| - \| - \| - \| `12ms` \| n\/a \|/u,
  );

  const surfaceCoverageSection = readme.slice(
    readme.indexOf("<!-- surface-release-coverage:start -->"),
    readme.indexOf("<!-- surface-release-coverage:end -->"),
  );
  assert.match(surfaceCoverageSection, /\| `2026\.6\.1` \| `14ms` \| - \|/u);
  assert.match(surfaceCoverageSection, /\| `2026\.6\.1-beta\.3` \| `13ms` \| `456ms` \|/u);
  assert.match(surfaceCoverageSection, /\| `2026\.6\.1-beta\.2` \| `12ms` \| n\/a \|/u);
});

test("uses the shared release axis for all nine supported RPC releases", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  const supportedVersions = [
    "2026.5.28-beta.1",
    "2026.5.28-beta.3",
    "2026.5.28-beta.4",
    "2026.5.28",
    "2026.5.30-beta.1",
    "2026.5.31-beta.1",
    "2026.5.31-beta.2",
    "2026.5.31-beta.3",
    "2026.5.31-beta.4",
  ];
  const releaseVersions = ["2026.5.27", ...supportedVersions];
  await writeJsonl(
    path.join(workspace, "data/channels/telegram.jsonl"),
    releaseVersions.map((version, index) =>
      rttRow({
        package: { spec: `openclaw@${version}`, version },
        run: {
          id: `telegram-${version}`,
          startedAt: `2026-05-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`,
          status: "pass",
        },
      }),
    ),
  );

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const surfaceCoverageSection = readme.slice(
    readme.indexOf("<!-- surface-release-coverage:start -->"),
    readme.indexOf("<!-- surface-release-coverage:end -->"),
  );
  for (const version of supportedVersions) {
    assert.ok(
      surfaceCoverageSection.includes(`| \`${version}\` | - | n/a |`),
      `missing supported RPC release ${version}`,
    );
  }
  assert.match(surfaceCoverageSection, /\| `2026\.5\.27` \| n\/a \| n\/a \|/u);
});

test("renders release coverage failure cells without verbose labels", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  const version = "2026.5.16-beta.6";
  const timeoutVersion = "2026.5.16-beta.5";
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    rttRow({
      package: { spec: `openclaw@${version}`, version },
      run: { id: "telegram-fail", startedAt: "2026-05-18T00:00:00.000Z", status: "fail" },
      rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/discord.jsonl"), [
    rttRow({
      package: { spec: `openclaw@${version}`, version },
      run: { id: "discord-partial", startedAt: "2026-05-18T00:01:00.000Z", status: "fail" },
      rtt: { warmSamples: [7844], p50Ms: 7844, p95Ms: 7844 },
    }),
    rttRow({
      package: { spec: `openclaw@${timeoutVersion}`, version: timeoutVersion },
      run: { id: "discord-timeout", startedAt: "2026-05-18T00:01:00.000Z", status: "fail" },
      rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
      discord: {
        samples: [
          {
            index: 1,
            status: "fail",
            details: "timed out after 45000ms waiting for Discord message",
          },
        ],
      },
    }),
  ]);
  for (const [channel, label] of [
    ["slack", "Slack"],
    ["whatsapp", "WhatsApp"],
  ]) {
    const details =
      channel === "whatsapp"
        ? JSON.stringify({
            error: {
              output: {
                statusCode: 401,
                payload: { message: "Connection Failure" },
              },
            },
          })
        : undefined;
    await writeJsonl(path.join(workspace, `data/channels/${channel}.jsonl`), [
      {
        channel: { id: channel, label, scenario: `${channel}-canary` },
        ...rttRow({
          package: { spec: `openclaw@${version}`, version },
          run: { id: `${channel}-fail`, startedAt: "2026-05-18T00:02:00.000Z", status: "fail" },
          rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
          samples: details ? [{ index: 1, status: "fail", details }] : [],
        }),
      },
    ]);
  }

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const coverageSection = readme.slice(
    readme.indexOf("<!-- release-coverage:start -->"),
    readme.indexOf("<!-- release-coverage:end -->"),
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.16-beta\.6` \| n\/a \| fail \| `7,844ms` \| fail \| logged out \| n\/a \| n\/a \|/u,
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.16-beta\.5` \| n\/a \| - \| timeout \| - \| - \| n\/a \| n\/a \|/u,
  );
  assert.doesNotMatch(coverageSection, /failed:/u);

  const discordSection = readme.slice(
    readme.indexOf("<!-- discord-release-sweep:start -->"),
    readme.indexOf("<!-- discord-release-sweep:end -->"),
  );
  assert.match(discordSection, /\| `2026\.5\.16-beta\.5` \| - \| - \| n\/a \| n\/a \| timeout \|/u);

  const whatsappSection = readme.slice(
    readme.indexOf("<!-- whatsapp-release-sweep:start -->"),
    readme.indexOf("<!-- whatsapp-release-sweep:end -->"),
  );
  assert.match(whatsappSection, /\| `2026\.5\.16-beta\.6` \| - \| - \| n\/a \| n\/a \| logged out: relink required \|/u);
});

test("keeps prior release RTT visible when a newer import has only RSS", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  const version = "2026.5.16-beta.6";
  await writeJsonl(path.join(workspace, "data/channels/telegram.jsonl"), [
    rttRow({
      package: { spec: `openclaw@${version}`, version },
      run: { id: "telegram-pass", startedAt: "2026-05-18T00:00:00.000Z", status: "pass" },
      rtt: { warmSamples: [1400], p50Ms: 1400, p95Ms: 1500 },
    }),
  ]);
  await writeJsonl(path.join(workspace, "data/channels/discord.jsonl"), [
    rttRow({
      package: { spec: `openclaw@${version}`, version },
      run: { id: "discord-partial", startedAt: "2026-05-18T00:01:00.000Z", status: "fail" },
      rtt: { warmSamples: [7800], p50Ms: 7800, p95Ms: 7900 },
      resources: { maxRssKb: { p50: 700000, p95: 710000, max: 710000 } },
    }),
    rttRow({
      package: { spec: `openclaw@${version}`, version },
      run: { id: "discord-all-failed", startedAt: "2026-05-18T00:05:00.000Z", status: "fail" },
      rtt: { warmSamples: [], p50Ms: undefined, p95Ms: undefined },
      resources: { maxRssKb: { p50: 786432, p95: 798720, max: 798720 } },
    }),
  ]);
  for (const [channel, label, p50] of [
    ["slack", "Slack", 4700],
    ["whatsapp", "WhatsApp", 7600],
  ]) {
    await writeJsonl(path.join(workspace, `data/channels/${channel}.jsonl`), [
      {
        channel: { id: channel, label, scenario: `${channel}-canary` },
        ...rttRow({
          package: { spec: `openclaw@${version}`, version },
          run: { id: `${channel}-pass`, startedAt: "2026-05-18T00:02:00.000Z", status: "pass" },
          rtt: { warmSamples: [p50], p50Ms: p50, p95Ms: p50 + 100 },
        }),
      },
    ]);
  }

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const coverageSection = readme.slice(
    readme.indexOf("<!-- release-coverage:start -->"),
    readme.indexOf("<!-- release-coverage:end -->"),
  );
  assert.match(
    coverageSection,
    /\| `2026\.5\.16-beta\.6` \| `2,602ms` \| `1,400ms` \| `7,800ms` \| `4,700ms` \| `7,600ms` \| n\/a \| n\/a \|/u,
  );

  const discordSection = readme.slice(
    readme.indexOf("<!-- discord-release-sweep:start -->"),
    readme.indexOf("<!-- discord-release-sweep:end -->"),
  );
  assert.match(
    discordSection,
    /\| `2026\.5\.16-beta\.6` \| `7,800ms` \| `7,900ms` \| `768MB` \| `780MB` \|/u,
  );
});

test("renders numeric post releases after stable in descending release order", async () => {
  const workspace = await makeWorkspace();
  await writeReadme(workspace);
  const versions = [
    "2026.7.1-beta.4",
    "2026.7.1",
    "2026.7.1-1",
    "2026.7.1-2",
  ];
  await writeJsonl(
    path.join(workspace, "data/channels/telegram.jsonl"),
    versions.map((version, index) =>
      rttRow({
        package: { spec: `openclaw@${version}`, version },
        run: {
          id: `telegram-${version}`,
          startedAt: `2026-07-01T00:0${index}:00.000Z`,
          status: "pass",
        },
        rtt: { warmSamples: [1000 + index], p50Ms: 1000 + index, p95Ms: 2000 + index },
      }),
    ),
  );

  await execFileAsync(process.execPath, [UPDATE_README_SCRIPT], { cwd: workspace });

  const readme = await fs.readFile(path.join(workspace, "README.md"), "utf8");
  const telegramSection = readme.slice(
    readme.indexOf("<!-- release-sweep:start -->"),
    readme.indexOf("<!-- release-sweep:end -->"),
  );
  const positions = versions.map((version) => telegramSection.indexOf(`\`${version}\``));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), [
    positions[3],
    positions[2],
    positions[1],
    positions[0],
  ]);
});
