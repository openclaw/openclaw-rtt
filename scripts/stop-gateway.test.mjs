import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import { stopGateway } from "./stop-gateway.mjs";

function spawnNode(script, { stdout = "ignore" } = {}) {
  return spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", stdout, "ignore"],
  });
}

function timeoutCount() {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

function fakeRunningChildWithTermError() {
  const child = new EventEmitter();
  child.pid = 42;
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGTERM") {
      queueMicrotask(() => child.emit("error", new Error("unrelated child error")));
    } else {
      queueMicrotask(() => {
        child.signalCode = "SIGKILL";
        child.emit("exit", null, "SIGKILL");
      });
    }
    return true;
  };
  return child;
}

test("stopGateway does not signal a child that failed to spawn", async () => {
  const child = spawn("openclaw-rtt-missing-stop-gateway-command");
  const spawnError = once(child, "error");

  await stopGateway(child);
  await spawnError;

  assert.equal(child.pid, undefined);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("stopGateway still escalates when a running child emits an error", async () => {
  const child = fakeRunningChildWithTermError();

  await stopGateway(child, { waitMs: 10, killWaitMs: 100 });

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.signalCode, "SIGKILL");
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("stopGateway clears its timer and listeners after a prompt exit", async () => {
  const child = spawnNode("setInterval(() => {}, 1000);");
  await once(child, "spawn");
  const before = timeoutCount();

  await stopGateway(child, { waitMs: 5_000 });

  assert.notEqual(child.signalCode, null);
  assert.equal(timeoutCount(), before, "leftover wait timer must be cleared");
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("stopGateway waits for exit after SIGKILL when SIGTERM is ignored", async () => {
  const child = spawnNode(
    'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
    { stdout: "pipe" },
  );
  await once(child.stdout, "data");
  const before = timeoutCount();

  await stopGateway(child, { waitMs: 20, killWaitMs: 1_000 });

  assert.equal(child.signalCode, "SIGKILL");
  assert.equal(timeoutCount(), before, "signal deadlines must be cleared");
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});
