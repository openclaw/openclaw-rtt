import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  connectGateway,
  GatewayExitedBeforeReadyError,
  measureMethod,
  prepareBenchmarkConfig,
  resolveOpenClawLaunch,
  waitForGatewayReady,
} from "./measure-rpc-rtt.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("connects with the least-privilege read scope", async () => {
  let options;
  class FakeGatewayClient {
    constructor(receivedOptions) {
      options = receivedOptions;
    }

    start() {
      options.onHelloOk();
    }
  }

  const client = await connectGateway({
    GatewayClient: FakeGatewayClient,
    port: 18789,
    token: "test-token",
  });

  assert.ok(client instanceof FakeGatewayClient);
  assert.deepEqual(options.scopes, ["operator.read"]);
  assert.equal(options.scopes.includes("operator.admin"), false);
});

test("launches the built OpenClaw entry without the mutable source runner", () => {
  assert.deepEqual(resolveOpenClawLaunch("/repo"), {
    command: process.execPath,
    args: [path.join("/repo", "openclaw.mjs")],
  });
});

test("disables hosted model catalog traffic for local RPC measurement", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-config-"));
  t.after(() => fs.rm(tempDir, { force: true, recursive: true }));

  const configPath = await prepareBenchmarkConfig(tempDir);
  const contents = await fs.readFile(configPath, "utf8");

  assert.deepEqual(JSON.parse(contents), {
    models: { catalogRefresh: { enabled: false } },
  });
  assert.equal(
    contents,
    '{\n  "models": {\n    "catalogRefresh": {\n      "enabled": false\n    }\n  }\n}\n',
  );
});

test("observes gateway exit without waiting for the readiness deadline", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const startedAt = Date.now();
  setImmediate(() => {
    child.exitCode = 1;
    child.emit("exit", 1, null);
  });

  await assert.rejects(
    waitForGatewayReady(
      { child },
      18789,
      Date.now() + 45_000,
      {
        readGatewayStderrFn: async () => "startup failed\n",
        waitForReadyFn: async (_port, _deadlineMs, { signal }) =>
          await new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stderr, "startup failed\n");
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("uses a startup budget only for untimed warmup requests", async () => {
  const timeouts = [];
  const client = {
    request: async (_method, _params, options) => {
      timeouts.push(options.timeoutMs);
    },
  };

  const result = await measureMethod(client, "health", 2, 1);

  assert.deepEqual(timeouts, [30_000, 10_000, 10_000]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.warmupSamples.length, 1);
  assert.equal(result.samples.length, 2);
});

test("main surface workflow builds once outside the timed samples", async () => {
  const workflow = await fs.readFile(
    path.join(REPO_ROOT, ".github/workflows/main-surface-rtt.yml"),
    "utf8",
  );
  const rpcStep = workflow.slice(
    workflow.indexOf("- name: Run RPC RTT samples"),
    workflow.indexOf("- name: Upload RPC RTT artifacts"),
  );
  assert.equal((workflow.match(/\n\s+pnpm build\n/gu) ?? []).length, 1);
  assert.ok(workflow.indexOf("pnpm build") < workflow.indexOf("Run RPC RTT samples"));
  assert.match(rpcStep, /echo "attempts=1" >>"\$metrics_path"/u);
});
