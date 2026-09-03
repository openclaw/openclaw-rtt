import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { OPENCLAW_QA_HARNESS_SHA } from "./openclaw-qa-harness.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_PATH = path.join(REPO_ROOT, "scripts/handle-missing-release-imports.mjs");
const WORKFLOWS = [
  {
    family: "surface",
    path: ".github/workflows/release-surface-rtt.yml",
  },
  {
    family: "channel",
    path: ".github/workflows/release-channel-rtt.yml",
  },
  {
    family: "Discord",
    path: ".github/workflows/stable-release-discord-rtt.yml",
  },
];

test("missing release imports fail only after a successful matrix", async () => {
  for (const result of ["failure", "cancelled"]) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      HELPER_PATH,
      "surface",
      result,
    ]);
    assert.equal(stderr, "");
    assert.match(stdout, new RegExp(`::notice .*matrix result was ${result}`, "u"));
  }

  await assert.rejects(
    execFileAsync(process.execPath, [HELPER_PATH, "surface", "success"]),
    /No surface release RTT import artifacts arrived after a successful matrix/u,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [HELPER_PATH, "surface", "skipped"]),
    /Unexpected surface release RTT measure result: skipped/u,
  );
});

test("release report workflows preserve partial imports without cascade failures", async () => {
  for (const workflow of WORKFLOWS) {
    const contents = await fs.readFile(path.join(REPO_ROOT, workflow.path), "utf8");
    assert.match(contents, /MEASURE_RESULT: \$\{\{ needs\.measure\.result \}\}/u);
    assert.match(
      contents,
      new RegExp(
        `node scripts/handle-missing-release-imports\\.mjs ${workflow.family} "\\$MEASURE_RESULT"`,
        "u",
      ),
    );
    assert.doesNotMatch(contents, /needs\.measure\.result != 'cancelled'/u);
  }
});

test("release channel QA compatibility uses one immutable tested OpenClaw source", async () => {
  for (const workflowPath of [
    ".github/workflows/stable-release-discord-rtt.yml",
    ".github/workflows/release-channel-rtt.yml",
  ]) {
    const workflow = await fs.readFile(path.join(REPO_ROOT, workflowPath), "utf8");
    const qaCheckout = workflow
      .split("      - name: Checkout OpenClaw QA harness\n")[1]
      ?.split("      - name:")[0];
    assert.ok(qaCheckout, `${workflowPath} must checkout the QA harness`);
    assert.match(qaCheckout, /ref: \$\{\{ matrix\.package\.qa_ref \}\}/u);
    assert.doesNotMatch(qaCheckout, /ref: main/u);
    assert.match(workflow, /Verify OpenClaw release ref/u);
    assert.match(workflow, /Verify OpenClaw QA harness ref/u);
    assert.match(workflow, /node scripts\/patch-openclaw-release-qa-harness\.mjs \.\.\/openclaw-qa/u);
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts/resolve-openclaw-channel-package.mjs")],
    {
      cwd: await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "rtt-harness-test-")),
      env: {
        ...process.env,
        GITHUB_OUTPUT: "",
        INPUT_AVAILABLE_VERSIONS: "2026.5.16-beta.3",
        INPUT_CHANNELS: "slack",
        INPUT_VERSIONS: "2026.5.16-beta.3",
      },
    },
  );
  const matrixLine = stdout.split("\n").find((line) => line.startsWith("matrix="));
  const matrix = JSON.parse(matrixLine.slice("matrix=".length));
  assert.equal(matrix[0].qa_ref, OPENCLAW_QA_HARNESS_SHA);
});

test("release surface workflow measures native RPC and Control UI", async () => {
  const workflow = await fs.readFile(
    path.join(REPO_ROOT, ".github/workflows/release-surface-rtt.yml"),
    "utf8",
  );
  assert.match(workflow, /default: "rpc control-ui"/u);
  assert.match(workflow, /scripts\/measure-rpc-rtt\.mjs/u);
  assert.match(workflow, /scripts\/measure-control-ui-rtt\.mjs/u);
  assert.match(workflow, /provider_mode=/u);
  assert.match(workflow, /--provider-mode "\$provider_mode"/u);
  assert.match(workflow, /if ! \/usr\/bin\/time[\s\S]*scripts\/measure-rpc-rtt\.mjs/u);
  assert.match(
    workflow,
    /if \[\[ "\$surface" == "control-ui" \]\]; then[\s\S]*import_args\+=\(--require-pass\)/u,
  );
});
