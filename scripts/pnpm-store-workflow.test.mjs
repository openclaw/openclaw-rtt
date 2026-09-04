import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const MANAGE_VERSION_ENV = 'PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: "false"';
const LATE_MANAGE_VERSION_SETTING = "--config.manage-package-manager-versions=false";
const MEASUREMENT_WORKFLOWS = [
  "main-rtt.yml",
  "main-discord-rtt.yml",
  "main-channel-rtt.yml",
  "main-surface-rtt.yml",
  "stable-release-rtt.yml",
  "stable-release-discord-rtt.yml",
  "release-channel-rtt.yml",
  "release-surface-rtt.yml",
];

test("RTT measurement workflows use the native pnpm runtime setup", async () => {
  for (const filename of MEASUREMENT_WORKFLOWS) {
    const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
    assert.doesNotMatch(workflow, /pnpm\/action-setup@/u, `${filename} uses legacy pnpm setup`);
    assert.equal(
      workflow.match(/uses: pnpm\/setup@v2\.1\.0/gu)?.length,
      1,
      `${filename} must configure one native pnpm runtime`,
    );
    const setup = workflow
      .split("      - name: Setup Node and pnpm\n")[1]
      ?.split(/\n      - name:/u)[0];
    assert.ok(setup, `${filename} is missing the combined runtime setup`);
    assert.match(setup, /version: \$\{\{ env\.PNPM_VERSION \}\}/u);
    assert.match(setup, /runtime: node@\$\{\{ env\.NODE_VERSION \}\}/u);
    assert.match(setup, /install: false/u);
  }
});

test("workflow-owned pnpm remains authoritative during every OpenClaw install", async () => {
  let installCount = 0;
  for (const filename of (await fs.readdir(workflowsDir)).filter((name) => name.endsWith(".yml"))) {
    const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
    const installLines = workflow
      .split("\n")
      .filter((line) => /^\s*time pnpm install\b/u.test(line));
    installCount += installLines.length;
    if (installLines.length === 0) continue;

    const workflowHeader = workflow.split("\njobs:\n", 1)[0];
    assert.ok(
      workflowHeader.includes(MANAGE_VERSION_ENV),
      `${filename} must disable packageManager-driven pnpm switching before pnpm starts`,
    );
    assert.ok(
      installLines.every((line) => !line.includes(LATE_MANAGE_VERSION_SETTING)),
      `${filename} must not rely on the install command to disable pnpm version switching`,
    );
  }
  assert.ok(installCount > 0, "expected at least one workflow pnpm install");
});

for (const filename of (await fs.readdir(workflowsDir)).filter((name) => name.endsWith(".yml"))) {
  const workflow = await fs.readFile(new URL(filename, workflowsDir), "utf8");
  const step = workflow.split("      - name: Locate pnpm store\n")[1]?.split("      - name:")[0];
  if (!step) continue;
  const script = step.split("        run: |\n")[1]?.replace(/^ {10}/gmu, "").trim();
  assert.ok(script, `${filename} must contain a runnable store lookup`);

  test(`${filename}: pnpm store lookup preserves success and rejects failed or empty output`, async (t) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-pnpm-store-test-"));
    t.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const outputPath = path.join(workspace, "github-output");
    const storePath = path.join(workspace, "store with spaces");
    const stub = [
      "pnpm() {",
      '  printf "%s" "$TEST_PNPM_OUTPUT"',
      '  return "$TEST_PNPM_EXIT"',
      "}",
    ].join("\n");

    for (const fixture of [
      { output: storePath, exit: "0", succeeds: true },
      { output: storePath, exit: "17", succeeds: false },
      { output: "", exit: "0", succeeds: false },
    ]) {
      await fs.writeFile(outputPath, "");
      const result = await execFileAsync("bash", ["-c", `${stub}\n${script}`], {
        cwd: workspace,
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          TEST_PNPM_OUTPUT: fixture.output,
          TEST_PNPM_EXIT: fixture.exit,
        },
      }).then(
        () => ({ code: 0 }),
        (error) => ({ code: error.code }),
      );
      const output = await fs.readFile(outputPath, "utf8");
      if (fixture.succeeds) {
        assert.equal(result.code, 0);
        assert.equal(output, `path=${storePath}\n`);
      } else {
        assert.equal(typeof result.code, "number");
        assert.notEqual(result.code, 0, `must reject pnpm exit=${fixture.exit} output=${fixture.output}`);
        assert.equal(output, "", "failed lookup must not publish a cache path");
      }
    }
  });
}
