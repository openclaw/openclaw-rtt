import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS_ROOT = path.join(REPO_ROOT, ".github/workflows");

async function readWorkflow(filename) {
  return await fs.readFile(path.join(WORKFLOWS_ROOT, filename), "utf8");
}

function jobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing ${jobName} job`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-zA-Z0-9_-]+:\n/u);
  return remainder.slice(0, nextJob === -1 ? undefined : nextJob);
}

test("CI owns README validation without a hydration workflow", async () => {
  await assert.rejects(
    fs.access(path.join(WORKFLOWS_ROOT, "readme-hydration.yml")),
    (error) => error?.code === "ENOENT",
  );

  const workflow = await readWorkflow("ci.yml");
  assert.match(
    workflow,
    /group: ci-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.run_id \}\}/u,
  );
  assert.match(
    workflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/u,
  );
  const verifyReadme = workflow
    .split("      - name: Verify README generation\n")[1]
    ?.split(/\n      - name:/u)[0];
  assert.ok(verifyReadme, "missing README verification step");
  assert.doesNotMatch(verifyReadme, /^\s+if:/mu);
  assert.match(verifyReadme, /node scripts\/update-readme\.mjs/u);
  assert.match(verifyReadme, /git diff --exit-code README\.md/u);
});

const SPLIT_WRITER_WORKFLOWS = [
  "main-channel-rtt.yml",
  "stable-release-discord-rtt.yml",
  "release-channel-rtt.yml",
  "release-surface-rtt.yml",
];

for (const filename of SPLIT_WRITER_WORKFLOWS) {
  test(`${filename}: measurement is read-only and report owns repository writes`, async () => {
    const workflow = await readWorkflow(filename);
    const header = workflow.split("\njobs:\n", 1)[0];
    assert.match(header, /^permissions:\n  actions: read\n  contents: read$/mu);

    const measure = jobBlock(workflow, "measure");
    const report = jobBlock(workflow, "report");
    const measurementCheckout = measure
      .split("      - name: Checkout RTT tracker\n")[1]
      ?.split(/\n      - name:/u)[0];
    assert.ok(measurementCheckout, "missing measurement checkout");
    assert.match(measurementCheckout, /persist-credentials: false/u);
    assert.doesNotMatch(measure, /contents: write/u);
    assert.match(report, /^    permissions:\n      actions: read\n      contents: write$/mu);
  });
}

test("Release Channel keeps coverage serial while avoiding the main-channel schedule", async () => {
  const workflow = await readWorkflow("release-channel-rtt.yml");
  assert.match(workflow, /- cron: "15 3,9,15,21 \* \* \*"/u);
  assert.doesNotMatch(workflow, /- cron: "55 \*\/6 \* \* \*"/u);
  const measure = jobBlock(workflow, "measure");
  assert.match(measure, /max-parallel: 1/u);
  assert.match(
    jobBlock(workflow, "resolve"),
    /INPUT_VERSION_LIMIT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.version_limit \|\| '' \}\}/u,
  );
});

const RELEASE_MATRIX_JOB_NAMES = new Map([
  [
    "stable-release-discord-rtt.yml",
    "Measure OpenClaw Discord ${{ matrix.package.version }} release RTT",
  ],
  [
    "release-channel-rtt.yml",
    "Measure OpenClaw ${{ matrix.package.label }} ${{ matrix.package.version }} release RTT",
  ],
  [
    "release-surface-rtt.yml",
    "Measure OpenClaw ${{ matrix.package.label }} ${{ matrix.package.version }} release RTT",
  ],
]);

for (const [filename, expectedName] of RELEASE_MATRIX_JOB_NAMES) {
  test(`${filename}: release matrix job names include the package version`, async () => {
    const workflow = await readWorkflow(filename);
    assert.ok(jobBlock(workflow, "measure").split("\n").includes(`    name: ${expectedName}`));
  });
}

test("Main Channel has no unreachable pull-request sampling branch", async () => {
  const workflow = await readWorkflow("main-channel-rtt.yml");
  assert.doesNotMatch(workflow, /CHANNEL_RTT_PR_SAMPLES/u);
  assert.ok(!workflow.includes('GITHUB_EVENT_NAME}" == "pull_request"'));
  assert.match(workflow, /samples="\$\{INPUT_SAMPLES:-20\}"/u);
});
