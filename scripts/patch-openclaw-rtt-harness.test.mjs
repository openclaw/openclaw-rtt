import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-rtt-harness.mjs");

const discordScenarioSource = `async function runDiscordScenario() {
    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
      expectedTextIncludes: run.expectedTextIncludes,
      message: matched.message,
    });
    return { details: "reply matched" };
}
`;
const discordRuntimeSource = `const testing = {
  computeDiscordRttMs,
};
`;
const slackScenarioSource = `async function runSlackScenario() {
    const responseObservedAt = new Date(reply.observedAt);
    const rttMs = responseObservedAt.getTime() - requestStartedAt.getTime();
    return {
      details: [\`reply matched in \${rttMs}ms\`, beforeRunDetails, observedDetails, afterReplyDetails]
        .filter(Boolean)
        .join("; "),
    };
}
`;
const flowRunnerSource = `function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runScenarioFlow(params) {
  const vars = params.vars ?? {};
  const steps = [{
    name: "module",
    run: async () => {
      vars.result = params.moduleResult;
    },
  }];
  return await params.api.runScenario(params.scenarioTitle, steps);
}
`;

async function makeFixture({
  discordScenario = discordScenarioSource,
  discordRuntime = discordRuntimeSource,
  slackScenario = slackScenarioSource,
  flowRunner = flowRunnerSource,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-patch-test-"));
  const qaRoot = path.join(root, "extensions/qa-lab/src");
  const discordRoot = path.join(qaRoot, "live-transports/discord");
  const slackRoot = path.join(qaRoot, "live-transports/slack");
  const discordScenarioPath = path.join(discordRoot, "scenario-runtime.ts");
  const discordRuntimePath = path.join(discordRoot, "discord-live.runtime.ts");
  const slackScenarioPath = path.join(slackRoot, "scenario-runtime.ts");
  const flowRunnerPath = path.join(qaRoot, "scenario-flow-runner.ts");
  await Promise.all([
    fs.mkdir(discordRoot, { recursive: true }),
    fs.mkdir(slackRoot, { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(discordScenarioPath, discordScenario),
    fs.writeFile(discordRuntimePath, discordRuntime),
    fs.writeFile(slackScenarioPath, slackScenario),
    fs.writeFile(flowRunnerPath, flowRunner),
  ]);
  return { discordScenarioPath, flowRunnerPath, root, slackScenarioPath };
}

test("restores structured RTT evidence idempotently", async (t) => {
  const { discordScenarioPath, flowRunnerPath, root, slackScenarioPath } =
    await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched 3 OpenClaw RTT evidence contracts/u);

  const [discordPatched, slackPatched, flowPatched] = await Promise.all([
    fs.readFile(discordScenarioPath, "utf8"),
    fs.readFile(slackScenarioPath, "utf8"),
    fs.readFile(flowRunnerPath, "utf8"),
  ]);
  assert.match(discordPatched, /finalMatchedReplyRttMs: rttMs/u);
  assert.match(slackPatched, /finalMatchedReplyRttMs: rttMs/u);
  assert.match(flowPatched, /timing: \{ rttMs \}/u);

  const executableFlowPath = path.join(root, "scenario-flow-runner.mjs");
  await fs.writeFile(executableFlowPath, flowPatched);
  const flowModule = await import(`${pathToFileURL(executableFlowPath).href}?test=${Date.now()}`);
  const result = await flowModule.runScenarioFlow({
    scenarioTitle: "Discord canary",
    flow: { steps: [] },
    moduleResult: {
      rttMeasurement: {
        finalMatchedReplyRttMs: 321,
      },
    },
    api: {
      runScenario: async (name, steps) => {
        for (const step of steps) {
          await step.run();
        }
        return { name, status: "pass", steps: [] };
      },
    },
  });
  assert.deepEqual(result.timing, { rttMs: 321 });

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /already patched/u);
  assert.equal(await fs.readFile(discordScenarioPath, "utf8"), discordPatched);
  assert.equal(await fs.readFile(slackScenarioPath, "utf8"), slackPatched);
  assert.equal(await fs.readFile(flowRunnerPath, "utf8"), flowPatched);
});

test("fails closed when an RTT scenario contract changes", async (t) => {
  const { root } = await makeFixture({ slackScenario: "export const changed = true;\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Slack RTT scenario contract/u,
  );
});

test("fails closed when the shared flow projection changes", async (t) => {
  const { root } = await makeFixture({ flowRunner: "export const changed = true;\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported QA flow RTT projection contract/u,
  );
});

test("fails closed when the Discord RTT helper is unavailable", async (t) => {
  const { root } = await makeFixture({ discordRuntime: "const testing = {};\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Discord RTT helper contract/u,
  );
});
