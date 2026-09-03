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
  assert.ok(
    block.split("\n").includes(expected),
    `expected exact line in block: ${expected}`,
  );
}

const channelWorkflows = [
  {
    filename: "main-channel-rtt.yml",
    measureGroup: "channel-rtt-measure-${{ matrix.channel }}",
  },
  {
    filename: "release-channel-rtt.yml",
    measureGroup: "channel-rtt-measure-${{ matrix.package.channel }}",
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

const reportWorkflows = [
  "main-channel-rtt.yml",
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
