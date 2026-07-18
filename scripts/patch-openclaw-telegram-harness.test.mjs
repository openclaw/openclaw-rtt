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
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-telegram-harness.mjs");

async function makeFixture(contents) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-harness-test-"));
  const scriptPath = path.join(root, "scripts/e2e/npm-telegram-live-docker.sh");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, contents);
  return { root, scriptPath };
}

test("preserves heredoc stdin across the Telegram heartbeat wrapper regression", async (t) => {
  const { root, scriptPath } = await makeFixture(`#!/usr/bin/env bash
run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\
run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\
`);
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched 2 Telegram harness stdin consumers/u);
  const patched = await fs.readFile(scriptPath, "utf8");
  assert.match(
    patched,
    /run_logged_print "npm-telegram-package-install" docker_e2e_docker_run_cmd run --rm/u,
  );
  assert.match(
    patched,
    /run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness/u,
  );
  assert.doesNotMatch(patched, /run_logged_print_heartbeat/u);

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /already preserve input/u);
  assert.equal(await fs.readFile(scriptPath, "utf8"), patched);
});

test("fails closed for an unknown upstream Telegram harness contract", async (t) => {
  const { root } = await makeFixture("#!/usr/bin/env bash\necho unknown\n");
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Telegram harness logging contract/u,
  );
});

test("fails closed for mixed or duplicate Telegram harness contracts", async (t) => {
  const fixtures = [
    `run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm
run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness
`,
    `run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm
run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm
run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness
`,
    `# run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\
custom_logger "npm-telegram-package-install" docker_e2e_docker_run_cmd run --rm \\
run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\
`,
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const fixture of fixtures) {
    const { root } = await makeFixture(fixture);
    roots.push(root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
      /Unsupported Telegram harness logging contract/u,
    );
  }
});
