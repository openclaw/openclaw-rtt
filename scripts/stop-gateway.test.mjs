import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { stopGateway } from "./stop-gateway.mjs";

function fakeChild({ alreadyExited = false, exitOnTerm = true } = {}) {
  const child = new EventEmitter();
  child.exitCode = alreadyExited ? 0 : null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGTERM" && exitOnTerm) {
      child.exitCode = 0;
      child.emit("exit", 0, null);
    }
  };
  return child;
}

function timeoutCount() {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

test("stopGateway clears the wait timer when the child exits first", async () => {
  const child = fakeChild({ exitOnTerm: true });
  const before = timeoutCount();
  await stopGateway(child, { waitMs: 5_000 });
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(timeoutCount(), before, "leftover wait timer must be cleared");
});

test("stopGateway is a no-op when the child already exited", async () => {
  const child = fakeChild({ alreadyExited: true });
  await stopGateway(child);
  assert.deepEqual(child.signals, []);
});

test("stopGateway sends SIGKILL when the child ignores SIGTERM", async () => {
  const child = fakeChild({ exitOnTerm: false });
  const before = timeoutCount();
  await stopGateway(child, { waitMs: 20 });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(timeoutCount(), before, "fired wait timer must still be cleared");
});
