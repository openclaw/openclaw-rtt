import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_PATH = path.join(REPO_ROOT, "scripts/handle-missing-release-imports.mjs");
const OPENCLAW_QA_SHA = "f50c6020e8f535beb6b442bbceadeae89568e6d0";
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

test("Discord release QA compatibility is pinned to the tested OpenClaw source", async () => {
  const workflow = await fs.readFile(
    path.join(REPO_ROOT, ".github/workflows/stable-release-discord-rtt.yml"),
    "utf8",
  );
  const qaCheckout = workflow
    .split("      - name: Checkout OpenClaw QA harness\n")[1]
    ?.split("      - name:")[0];
  assert.ok(qaCheckout, "Discord release workflow must checkout the QA harness");
  assert.match(qaCheckout, new RegExp(`ref: ${OPENCLAW_QA_SHA}`, "u"));
  assert.doesNotMatch(qaCheckout, /ref: main/u);
});
