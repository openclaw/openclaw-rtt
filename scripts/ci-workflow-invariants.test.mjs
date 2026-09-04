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

function stepBlock(job, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = job.indexOf(marker);
  assert.notEqual(start, -1, `missing ${stepName} step`);
  const remainder = job.slice(start + marker.length);
  const nextStep = remainder.indexOf("\n      - name:");
  return remainder.slice(0, nextStep === -1 ? undefined : nextStep);
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
  "main-surface-rtt.yml",
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

test("Main Surface preserves partial evidence across its read-only measurement boundary", async () => {
  const workflow = await readWorkflow("main-surface-rtt.yml");
  const measure = jobBlock(workflow, "measure");
  const report = jobBlock(workflow, "report");
  const prepare = stepBlock(measure, "Prepare main surface import artifact");
  const upload = stepBlock(measure, "Upload main surface import artifact");
  const localValidation = stepBlock(measure, "Validate Surface RTT imports");
  const download = stepBlock(report, "Download main surface import artifact");
  const importRpc = stepBlock(report, "Import main RPC Surface RTT");
  const importControlUi = stepBlock(report, "Import main Control UI Surface RTT");
  const validate = stepBlock(report, "Validate imported Surface RTT");
  const commit = stepBlock(report, "Commit imported Surface RTT");
  const terminal = stepBlock(report, "Fail after partial Surface RTT import");

  assert.doesNotMatch(measure, /\bgit push\b/u);
  assert.match(localValidation, /node "\$RTT_SCRIPTS_DIR\/update-readme\.mjs" --latest-main-only/u);
  assert.match(localValidation, /node "\$RTT_SCRIPTS_DIR\/validate\.mjs"/u);
  assert.match(
    measure,
    /^    outputs:\n      artifact_id: \$\{\{ steps\.upload_import\.outputs\.artifact-id \}\}\n      version: \$\{\{ steps\.openclaw_ref\.outputs\.version \}\}$/mu,
  );
  assert.match(report, /^    needs: measure$/mu);
  assert.match(report, /^    if: always\(\) && github\.event_name != 'pull_request'$/mu);
  assert.match(
    prepare,
    /if: always\(\) && \(steps\.rpc_surface_rtt\.outcome == 'success' \|\| steps\.surface_rtt\.outcome == 'success'\)/u,
  );
  assert.doesNotMatch(prepare, /manifest|metadata/u);
  assert.match(prepare, /cp -R "\$\{\{ steps\.rpc_surface_rtt\.outputs\.output_root \}\}" "\$BUNDLE_DIR\/rpc"/u);
  assert.match(
    prepare,
    /cp -R "\$\{\{ steps\.surface_rtt\.outputs\.output_root \}\}" "\$BUNDLE_DIR\/control-ui"/u,
  );
  assert.match(upload, /^        id: upload_import$/mu);
  assert.match(upload, /name: main-surface-rtt-import-v1-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.doesNotMatch(upload, /overwrite:/u);
  assert.match(upload, /if-no-files-found: error/u);
  assert.match(download, /if: needs\.measure\.outputs\.artifact_id != ''/u);
  assert.match(download, /artifact-ids: \$\{\{ needs\.measure\.outputs\.artifact_id \}\}/u);
  assert.doesNotMatch(download, /^\s+name:/mu);
  assert.match(download, /merge-multiple: true/u);
  for (const [step, surface, root, label] of [
    [importRpc, "rpc", "rpc", "RPC"],
    [importControlUi, "control-ui", "control-ui", "Control UI"],
  ]) {
    assert.match(step, /continue-on-error: true/u);
    assert.match(step, new RegExp(`--artifact-root "\\$artifact_root"[\\s\\S]*--surface ${surface}`, "u"));
    assert.match(step, new RegExp(`main-surface-rtt-import-v1/${root}`, "u"));
    assert.match(
      step,
      new RegExp(
        `if \\[\\[ ! -d "\\$artifact_root" \\]\\]; then[\\s\\S]*echo "Missing expected ${label} artifact root: \\$artifact_root" >&2[\\s\\S]*exit 1`,
        "u",
      ),
    );
    assert.match(step, /--version "\$VERSION"/u);
  }
  assert.match(importRpc, /--provider-mode gateway-rpc[\s\S]*--scenario rpc-gateway-smoke[\s\S]*--require-pass/u);
  assert.match(importControlUi, /--provider-mode mock-openai[\s\S]*--require-pass/u);
  assert.match(validate, /if: always\(\)/u);
  assert.match(validate, /continue-on-error: true/u);
  assert.match(validate, /node "\$RTT_SCRIPTS_DIR\/update-readme\.mjs" --latest-main-only/u);
  assert.match(validate, /node "\$RTT_SCRIPTS_DIR\/validate\.mjs"/u);
  assert.match(commit, /steps\.validate_imports\.outcome == 'success'/u);
  assert.doesNotMatch(commit, /import_(?:rpc|control_ui)_surface_rtt\.outcome == 'success'/u);
  assert.ok(
    report.indexOf("      - name: Import main RPC Surface RTT\n") <
      report.indexOf("      - name: Import main Control UI Surface RTT\n") &&
      report.indexOf("      - name: Import main Control UI Surface RTT\n") <
        report.indexOf("      - name: Validate imported Surface RTT\n") &&
      report.indexOf("      - name: Validate imported Surface RTT\n") <
        report.indexOf("      - name: Commit imported Surface RTT\n") &&
    report.indexOf("      - name: Commit imported Surface RTT\n") <
      report.indexOf("      - name: Fail after partial Surface RTT import\n"),
    "RPC evidence must validate and commit before a Control UI import failure becomes terminal",
  );
  assert.match(terminal, /if: always\(\)/u);
  assert.match(terminal, /CONTROL_UI_IMPORT_RESULT: \$\{\{ steps\.import_control_ui_surface_rtt\.outcome \}\}/u);
  assert.match(terminal, /if \[\[ "\$MEASURE_RESULT" != "success" \]\]/u);
  assert.match(workflow, /pull_request:[\s\S]*- "scripts\/import-surface-rtt\.mjs"/u);
  assert.doesNotMatch(workflow, /import-surface-bundle/u);
});

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

test("Release Channel confines live credentials to the skipped sample step", async () => {
  const workflow = await readWorkflow("release-channel-rtt.yml");
  const measure = jobBlock(workflow, "measure");
  const sample = stepBlock(measure, "Run ${{ matrix.package.label }} RTT samples");
  const workflowSecrets = workflow.match(/\$\{\{ secrets\.[A-Z0-9_]+ \}\}/gu) ?? [];
  const sampleSecrets = sample.match(/\$\{\{ secrets\.[A-Z0-9_]+ \}\}/gu) ?? [];

  assert.deepEqual(sampleSecrets, [
    "${{ secrets.OPENCLAW_QA_CONVEX_SITE_URL }}",
    "${{ secrets.OPENCLAW_QA_CONVEX_SECRET_CI }}",
  ]);
  assert.deepEqual(workflowSecrets, sampleSecrets);
  assert.match(
    sample,
    /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.prepare_only != true/u,
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
