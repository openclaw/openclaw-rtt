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
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-discord-rtt-harness.mjs");

const scenarioSource = `async function runDiscordScenario() {
    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
      expectedTextIncludes: run.expectedTextIncludes,
      message: matched.message,
    });
    return { details: "reply matched" };
}
`;
const runtimeSource = `const testing = {
  computeDiscordRttMs,
};
`;

async function makeFixture({ scenario = scenarioSource, runtime = runtimeSource } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-discord-rtt-patch-test-"));
  const discordRoot = path.join(root, "extensions/qa-lab/src/live-transports/discord");
  const scenarioPath = path.join(discordRoot, "scenario-runtime.ts");
  const runtimePath = path.join(discordRoot, "discord-live.runtime.ts");
  await fs.mkdir(discordRoot, { recursive: true });
  await Promise.all([
    fs.writeFile(scenarioPath, scenario),
    fs.writeFile(runtimePath, runtime),
  ]);
  return { root, scenarioPath };
}

test("restores Discord RTT evidence idempotently", async (t) => {
  const { root, scenarioPath } = await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched Discord RTT measurement contract/u);

  const patched = await fs.readFile(scenarioPath, "utf8");
  assert.match(patched, /computeDiscordRttMs/u);
  assert.match(patched, /finalMatchedReplyRttMs: rttMs/u);
  assert.match(patched, /source: "request-to-observed-message"/u);

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /already patched/u);
  assert.equal(await fs.readFile(scenarioPath, "utf8"), patched);
});

test("fails closed when the Discord scenario contract changes", async (t) => {
  const { root } = await makeFixture({ scenario: "export const changed = true;\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Discord RTT scenario contract/u,
  );
});

test("fails closed when the Discord RTT helper is unavailable", async (t) => {
  const { root } = await makeFixture({ runtime: "const testing = {};\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Discord RTT helper contract/u,
  );
});
