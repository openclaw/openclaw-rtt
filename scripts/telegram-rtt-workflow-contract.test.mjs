import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATHS = [
  ".github/workflows/main-rtt.yml",
  ".github/workflows/stable-release-rtt.yml",
];
const RETIRED_HELPER_PATHS = [
  "scripts/patch-openclaw-telegram-harness.mjs",
  "scripts/patch-openclaw-telegram-harness.test.mjs",
  "scripts/telegram-release-config-compat.mjs",
  "scripts/telegram-release-config-compat.d.mts",
  "scripts/telegram-release-config-compat.test.mjs",
];
const RTT_SELECTION =
  "OPENCLAW_NPM_TELEGRAM_RTT_CHECKS=telegram-reply-chain-exact-marker";
const IMPORT_SCENARIO = "--scenario telegram-reply-chain-exact-marker";
const CONVEX_SOURCE = "OPENCLAW_QA_CREDENTIAL_SOURCE: convex";
const CONVEX_ROLE = "OPENCLAW_QA_CREDENTIAL_ROLE: ci";
const PNPM_VERSION = 'PNPM_VERSION: "12.1.0"';

function countOccurrences(contents, value) {
  return contents.split(value).length - 1;
}

test("Telegram RTT workflows use the upstream harness contract", async () => {
  const workflows = await Promise.all(
    WORKFLOW_PATHS.map(async (relativePath) => ({
      contents: await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8"),
      relativePath,
    })),
  );

  const expectedRuns = [1, 2];
  assert.equal(countOccurrences(workflows[0].contents, RTT_SELECTION), expectedRuns[0]);
  assert.equal(countOccurrences(workflows[1].contents, RTT_SELECTION), expectedRuns[1]);

  for (const [index, { contents, relativePath }] of workflows.entries()) {
    assert.equal(countOccurrences(contents, PNPM_VERSION), 1);
    assert.equal(countOccurrences(contents, "uses: pnpm/action-setup@v6.0.10"), 1);
    assert.doesNotMatch(contents, /--ignore-scripts=false/u);
    assert.equal(countOccurrences(contents, CONVEX_SOURCE), expectedRuns[index]);
    assert.equal(countOccurrences(contents, CONVEX_ROLE), expectedRuns[index]);
    assert.equal(
      countOccurrences(contents, 'OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH: "1"'),
      expectedRuns[index],
    );
    assert.equal(
      countOccurrences(contents, "OPENCLAW_QA_CONVEX_SITE_URL: ${{ secrets.OPENCLAW_QA_CONVEX_SITE_URL }}"),
      expectedRuns[index],
    );
    assert.equal(
      countOccurrences(contents, "OPENCLAW_QA_CONVEX_SECRET_CI: ${{ secrets.OPENCLAW_QA_CONVEX_SECRET_CI }}"),
      expectedRuns[index],
    );
    assert.doesNotMatch(contents, /OPENCLAW_QA_TELEGRAM_(?:GROUP_ID|DRIVER_BOT_TOKEN|SUT_BOT_TOKEN)/u);
    assert.equal(
      countOccurrences(contents, IMPORT_SCENARIO),
      1,
      `${relativePath} must import the same exact-marker scenario`,
    );
    assert.doesNotMatch(contents, /OPENCLAW_NPM_TELEGRAM_SCENARIOS/u);
    assert.doesNotMatch(contents, /patch-openclaw-telegram-harness/u);
    assert.doesNotMatch(contents, /telegram-release-config-compat/u);

    const runIndex = contents.indexOf("- name: Run RTT");
    const cleanIndex = contents.indexOf("- name: Verify OpenClaw checkout is clean");
    assert.ok(runIndex >= 0 && cleanIndex > runIndex, `${relativePath} must verify after RTT`);
    assert.match(
      contents.slice(cleanIndex),
      /working-directory: openclaw[\s\S]*git status --porcelain[\s\S]*git status --short[\s\S]*exit 1/u,
    );
  }

  const mainWorkflow = workflows[0].contents;
  const runStep = mainWorkflow
    .split("      - name: Run RTT\n")[1]
    ?.split("      - name: Verify OpenClaw checkout is clean\n")[0];
  assert.ok(runStep, "main RTT workflow must contain the producer step");
  assert.match(runStep, /echo "status=\$status"/u);
  assert.doesNotMatch(runStep, /exit "\$status"/u);
  assert.match(mainWorkflow, /- name: Upload Telegram RTT diagnostics[\s\S]*if: always\(\)/u);
  assert.match(mainWorkflow, /\$\{\{ runner\.temp \}\}\/openclaw-rtt-runs\/main/u);
  assert.match(mainWorkflow, /\$\{\{ runner\.temp \}\}\/openclaw-rtt-resource-metrics\.env/u);
  assert.match(
    mainWorkflow,
    /- name: Fail when Telegram RTT producer fails[\s\S]*if: steps\.rtt\.outputs\.status != '0'[\s\S]*producer failed with status \$\{\{ steps\.rtt\.outputs\.status \}\}[\s\S]*exit 1/u,
  );
  assert.match(
    mainWorkflow,
    /- name: Import result\n\s+if: steps\.rtt\.outputs\.status == '0'/u,
  );
  assert.match(
    mainWorkflow,
    /- name: Commit result\n\s+if: steps\.rtt\.outputs\.status == '0'/u,
  );
});

test("retired Telegram harness helpers are absent and unreferenced", async () => {
  for (const relativePath of RETIRED_HELPER_PATHS) {
    await assert.rejects(fs.access(path.join(REPO_ROOT, relativePath)), { code: "ENOENT" });
  }

  const scriptNames = await fs.readdir(path.join(REPO_ROOT, "scripts"));
  const currentTest = path.basename(fileURLToPath(import.meta.url));
  const remainingScripts = scriptNames.filter(
    (name) =>
      name !== currentTest &&
      (name.endsWith(".mjs") || name.endsWith(".mts")),
  );
  for (const name of remainingScripts) {
    const contents = await fs.readFile(path.join(REPO_ROOT, "scripts", name), "utf8");
    assert.doesNotMatch(contents, /patch-openclaw-telegram-harness/u);
    assert.doesNotMatch(contents, /telegram-release-config-compat/u);
  }
});
