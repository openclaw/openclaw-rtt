import assert from "node:assert/strict";
import test from "node:test";

import { waitForReady } from "./wait-for-ready.mjs";

function hangingFetch(_url, init) {
  const signal = init?.signal;
  return new Promise((_resolve, reject) => {
    if (!signal) {
      return;
    }
    const abort = () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

test("waitForReady aborts a hung fetch so the deadline can fire", { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  let seenSignal;
  globalThis.fetch = (url, init) => {
    seenSignal = init?.signal;
    return hangingFetch(url, init);
  };
  try {
    await assert.rejects(() => waitForReady(1, Date.now() + 80), /Gateway did not become ready/);
    assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an AbortSignal");
    assert.equal(seenSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForReady cancels the body on a non-OK response", { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    body: {
      cancel: async () => {
        cancelled = true;
      },
    },
  });
  try {
    await assert.rejects(() => waitForReady(1, Date.now() + 40), /Gateway did not become ready/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
