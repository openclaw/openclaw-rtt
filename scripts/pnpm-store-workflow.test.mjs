import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workflowsDir = new URL("../.github/workflows/", import.meta.url);

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
