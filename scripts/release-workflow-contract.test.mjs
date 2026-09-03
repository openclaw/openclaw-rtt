import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const releaseWorkflows = [
  "release-surface-rtt.yml",
  "release-channel-rtt.yml",
  "stable-release-discord-rtt.yml",
];

function extractStep(workflow, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const step = workflow.split(marker)[1]?.split("\n      - name: ")[0];
  assert.ok(step, `expected workflow step: ${stepName}`);
  return step;
}

test("historical surface Chromium install uses the release dependency", async () => {
  const workflow = await fs.readFile(new URL("release-surface-rtt.yml", workflowsDir), "utf8");
  const step = extractStep(workflow, "Install Playwright Chromium");

  assert.match(step, /\bworking-directory:\s*openclaw\b/u);
  assert.match(step, /\bpnpm exec playwright-core install chromium\b/u);
  assert.doesNotMatch(step, /\|\|/u);
  assert.doesNotMatch(step, /\b(?:scripts\/|ensure-playwright-chromium)\b/u);
});

test("historical channel workflow selects and imports a stable QA summary", async () => {
  const workflow = await fs.readFile(new URL("release-channel-rtt.yml", workflowsDir), "utf8");
  const measureStep = extractStep(workflow, "Run ${{ matrix.package.label }} RTT samples");
  const prepareStep = extractStep(
    workflow,
    "Prepare ${{ matrix.package.label }} release import artifact",
  );
  const importStep = extractStep(workflow, "Import channel release RTT results");

  assert.match(measureStep, /scripts\/select-channel-qa-summary\.mjs/u);
  assert.match(measureStep, /"\$\{?selector_status\}?" -eq 0/u);
  assert.match(measureStep, /"\$\{?scenario_status\}?" == "pass"/u);
  assert.match(measureStep, /write-failed-channel-summary\.mjs" \\\n\s+"\$summary_path"/u);
  assert.match(measureStep, /summary_path="\$\{output_dir\}\/rtt-summary\.json"/u);
  assert.match(measureStep, /attempt_dir="\$\{output_dir\}\/attempt-\$\{attempt\}"/u);
  assert.match(measureStep, /rtt-summary-source\.json/u);
  assert.doesNotMatch(measureStep, /sample_paths/u);
  assert.doesNotMatch(measureStep, /node -e/u);
  assert.doesNotMatch(measureStep, /Array\.isArray\(summary\.scenarios\)/u);

  assert.match(prepareStep, /echo "summary=rtt-summary\.json"/u);
  assert.match(importStep, /summary_path="\$\{sample_dir\}\/\$\{summary\}"/u);
});

for (const filename of releaseWorkflows) {
  test(`${filename}: verifies the exact release tag commit`, async () => {
    const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
    const step = extractStep(workflow, "Verify OpenClaw release ref");

    assert.match(step, /tag_ref="refs\/tags\/\$\{\{ matrix\.package\.tag \}\}"/u);
    assert.match(step, /git rev-parse HEAD/u);
    assert.match(step, /git rev-parse --verify "\$\{tag_ref\}\^\{commit\}"/u);
    assert.match(
      step,
      /if \[\[ "\$head_commit" != "\$tag_commit" \]\]; then\n\s+echo "OpenClaw release ref mismatch: HEAD \$\{head_commit\} does not match \$\{tag_ref\} \(\$\{tag_commit\}\)" >&2\n\s+exit 1\n\s+fi/u,
    );
    assert.doesNotMatch(step, /package\.json/u);
    assert.doesNotMatch(step, /matrix\.package\.version/u);
    assert.doesNotMatch(step, /\|\||\bgit describe\b/u);
    assert.doesNotMatch(step, /\b(?:sed|awk|cut|tr)\b/u);
    assert.doesNotMatch(step, /\$\{[^}\n]*(?:%%?|##?|:-)[^}\n]*\}/u);
    assert.doesNotMatch(step, /tag_commit=.*(?:\$head_commit|\$\{head_commit\})/u);
  });
}
