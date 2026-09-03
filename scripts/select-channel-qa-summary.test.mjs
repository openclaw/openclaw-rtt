import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELECT_SCRIPT = path.join(REPO_ROOT, "scripts/select-channel-qa-summary.mjs");

async function makeOutputDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-summary-"));
}

async function writeJson(pathname, value) {
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`);
}

function modernSummary(scenario, status = "pass") {
  return {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-09-03T00:00:00.000Z",
    entries: [
      {
        test: { id: scenario, title: `${scenario} title` },
        result: { status },
      },
    ],
  };
}

function legacySummary(scenario, status = "pass") {
  return {
    startedAt: "2026-09-03T00:00:00.000Z",
    finishedAt: "2026-09-03T00:00:01.000Z",
    counts: {
      total: 1,
      passed: status === "pass" ? 1 : 0,
      failed: status === "pass" ? 0 : 1,
    },
    scenarios: [{ id: scenario, status, rttMs: 4165 }],
  };
}

function runSelector(outputDir, canonicalFilename, channel, scenario) {
  return spawnSync(
    process.execPath,
    [SELECT_SCRIPT, outputDir, canonicalFilename, channel, scenario],
    { encoding: "utf8" },
  );
}

async function readMetadata(outputDir) {
  return JSON.parse(await fs.readFile(path.join(outputDir, "rtt-summary-source.json"), "utf8"));
}

test("canonical evidence wins over a legacy summary and preserves exact bytes", async () => {
  const outputDir = await makeOutputDir();
  const canonicalBytes = `${JSON.stringify(modernSummary("slack-canary"), null, 3)}\n`;
  await fs.writeFile(path.join(outputDir, "qa-evidence.json"), canonicalBytes);
  await writeJson(
    path.join(outputDir, "slack-qa-summary.json"),
    legacySummary("slack-canary", "fail"),
  );

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "pass\n");
  assert.equal(
    await fs.readFile(path.join(outputDir, "rtt-summary.json"), "utf8"),
    canonicalBytes,
  );
  assert.deepEqual(await readMetadata(outputDir), {
    sourceFilename: "qa-evidence.json",
    schema: "openclaw.qa.evidence-summary",
    selection: "canonical",
    scenario: "slack-canary",
    status: "pass",
  });
});

test("legacy Slack summary is selected when canonical evidence is absent", async () => {
  const outputDir = await makeOutputDir();
  const legacyBytes = `${JSON.stringify(legacySummary("slack-canary"), null, 4)}\n`;
  await fs.writeFile(path.join(outputDir, "slack-qa-summary.json"), legacyBytes);

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "pass\n");
  assert.equal(await fs.readFile(path.join(outputDir, "rtt-summary.json"), "utf8"), legacyBytes);
  assert.deepEqual(await readMetadata(outputDir), {
    sourceFilename: "slack-qa-summary.json",
    schema: "channel-qa-summary",
    selection: "legacy",
    scenario: "slack-canary",
    status: "pass",
  });
});

test("legacy WhatsApp non-pass status is normalized to fail", async () => {
  const outputDir = await makeOutputDir();
  await writeJson(
    path.join(outputDir, "whatsapp-qa-summary.json"),
    legacySummary("whatsapp-canary", "timeout"),
  );

  const result = runSelector(outputDir, "qa-evidence.json", "whatsapp", "whatsapp-canary");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "fail\n");
  assert.equal((await readMetadata(outputDir)).status, "fail");
});

test("modern non-pass status is normalized to fail", async () => {
  const outputDir = await makeOutputDir();
  await writeJson(path.join(outputDir, "qa-evidence.json"), modernSummary("slack-canary", "skip"));

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "fail\n");
  assert.equal((await readMetadata(outputDir)).status, "fail");
});

test("malformed canonical evidence blocks a valid legacy fallback", async () => {
  const outputDir = await makeOutputDir();
  await fs.writeFile(path.join(outputDir, "qa-evidence.json"), "{not-json}\n");
  await writeJson(path.join(outputDir, "slack-qa-summary.json"), legacySummary("slack-canary"));

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 3);
  assert.equal(result.stdout, "invalid\n");
  await assert.rejects(fs.stat(path.join(outputDir, "rtt-summary.json")), { code: "ENOENT" });
  assert.deepEqual(await readMetadata(outputDir), {
    sourceFilename: "qa-evidence.json",
    schema: "openclaw.qa.evidence-summary",
    selection: "canonical",
    scenario: "slack-canary",
    status: "invalid",
  });
});

test("canonical evidence missing the requested scenario blocks legacy fallback", async () => {
  const outputDir = await makeOutputDir();
  await writeJson(path.join(outputDir, "qa-evidence.json"), modernSummary("other-scenario"));
  await writeJson(path.join(outputDir, "slack-qa-summary.json"), legacySummary("slack-canary"));

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 3);
  assert.equal(result.stdout, "invalid\n");
  assert.match(result.stderr, /missing scenario slack-canary/u);
});

test("missing canonical and legacy summaries reports missing", async () => {
  const outputDir = await makeOutputDir();

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "missing\n");
  assert.deepEqual(await readMetadata(outputDir), {
    sourceFilename: null,
    schema: null,
    selection: "none",
    scenario: "slack-canary",
    status: "missing",
  });
});

test("legacy summary must include importer-required fields and scenario", async () => {
  const outputDir = await makeOutputDir();
  const summary = legacySummary("slack-canary");
  delete summary.counts;
  await writeJson(path.join(outputDir, "slack-qa-summary.json"), summary);

  const result = runSelector(outputDir, "qa-evidence.json", "slack", "slack-canary");

  assert.equal(result.status, 3);
  assert.equal(result.stdout, "invalid\n");
  assert.match(result.stderr, /counts must be an object/u);
});
