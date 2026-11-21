import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);

function extractJob(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const job = workflow.split(marker)[1]?.split(/\n  [a-zA-Z0-9_-]+:\n/u)[0];
  assert.ok(job, `expected workflow job: ${jobName}`);
  return job;
}

function extractBlock(job, blockName) {
  const marker = `    ${blockName}:\n`;
  const block = job.split(marker)[1]?.split(/\n    [a-zA-Z0-9_-]+:/u)[0];
  assert.ok(block, `expected job block: ${blockName}`);
  return block;
}

function assertLine(block, expected) {
  assert.ok(block.split("\n").includes(expected), `expected exact line in block: ${expected}`);
}

const channelWorkflows = [
  {
    filename: "main-channel-rtt.yml",
    measureGroup: "channel-rtt-measure-${{ matrix.channel }}",
  },
];

for (const { filename, measureGroup } of channelWorkflows) {
  test(`${filename}: queues channel measurement jobs by shared channel`, async () => {
    const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
    const measure = extractJob(workflow, "measure");
    const concurrency = extractBlock(measure, "concurrency");
    const strategy = extractBlock(measure, "strategy");

    assertLine(concurrency, `      group: ${measureGroup}`);
    assertLine(concurrency, "      cancel-in-progress: false");
    assertLine(concurrency, "      queue: max");
    assert.doesNotMatch(concurrency, /github\.ref/u);
    assertLine(strategy, "      max-parallel: 1");
  });
}

test("release-channel-rtt.yml isolates prepare-only runs without changing normal channel queues", async () => {
  const workflow = await fs.readFile(new URL("release-channel-rtt.yml", workflowsDir), "utf8");
  const measure = extractJob(workflow, "measure");
  const concurrency = extractBlock(measure, "concurrency");
  const strategy = extractBlock(measure, "strategy");

  assertLine(
    concurrency,
    "      group: ${{ github.event_name == 'workflow_dispatch' && inputs.prepare_only && format('release-channel-rtt-prepare-{0}', github.run_id) || format('channel-rtt-measure-{0}', matrix.package.channel) }}",
  );
  assert.match(concurrency, /format\('channel-rtt-measure-\{0\}', matrix\.package\.channel\)/u);
  assert.match(concurrency, /format\('release-channel-rtt-prepare-\{0\}', github\.run_id\)/u);
  assertLine(concurrency, "      cancel-in-progress: false");
  assertLine(concurrency, "      queue: max");
  assert.doesNotMatch(concurrency, /github\.ref/u);
  assertLine(strategy, "      max-parallel: 1");
  assertLine(measure, "    environment: qa-live-shared");
});

const reportWorkflows = [
  "main-rtt.yml",
  "main-discord-rtt.yml",
  "stable-release-rtt.yml",
  "main-channel-rtt.yml",
  "main-surface-rtt.yml",
  "release-channel-rtt.yml",
  "release-surface-rtt.yml",
  "stable-release-discord-rtt.yml",
];

for (const filename of reportWorkflows) {
  test(`${filename}: queues report writer jobs without cancellation`, async () => {
    const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
    const report = extractJob(workflow, "report");
    const concurrency = extractBlock(report, "concurrency");

    assert.match(concurrency, /^\s+group: rtt-report-writer-/mu);
    assertLine(concurrency, "      cancel-in-progress: false");
    assertLine(concurrency, "      queue: max");
  });
}

test("Telegram RSS backfills hold the publication queue for each per-version merge", async () => {
  const workflow = await fs.readFile(new URL("stable-release-rtt.yml", workflowsDir), "utf8");
  const header = workflow.split("\njobs:\n")[0];
  assert.match(header, /inputs\.rss_backfill == 'true' && 'rtt-report-writer-main'/u);
  assert.match(header, /cancel-in-progress: false/u);
  assert.match(header, /queue: max/u);
  const step = workflow
    .split("      - name: Run RSS backfill\n")[1]
    .split("      - name: Run RTT\n")[0];
  assert.match(step, /for index in/u);
  assert.match(
    step,
    /publish-rtt-report\.mjs" prepare[\s\S]*backfill-release-rss\.mjs[\s\S]*publish-rtt-report\.mjs" publish --family telegram --key "\$version"[\s\S]*done/u,
  );
});
