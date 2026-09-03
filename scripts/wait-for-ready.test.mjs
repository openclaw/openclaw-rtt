import assert from "node:assert/strict";
import test from "node:test";

import { waitForReady } from "./wait-for-ready.mjs";

function hangingFetch(_url, init = {}) {
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

function mockResponse({ ok, status }) {
  let cancelled = false;
  return {
    response: {
      ok,
      status,
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    },
    wasCancelled: () => cancelled,
  };
}

test("waitForReady aborts hung headers when the deadline expires", { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  let seenSignal;
  let seenMethod;
  globalThis.fetch = (url, init = {}) => {
    seenSignal = init?.signal;
    seenMethod = init?.method;
    return hangingFetch(url, init);
  };
  try {
    await assert.rejects(() => waitForReady(1, Date.now() + 80), /Gateway did not become ready/);
    assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an AbortSignal");
    assert.equal(seenSignal.aborted, true);
    assert.equal(seenMethod, "HEAD");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForReady retries a 503, accepts a 200, and releases both bodies", async () => {
  const originalFetch = globalThis.fetch;
  const unavailable = mockResponse({ ok: false, status: 503 });
  const ready = mockResponse({ ok: true, status: 200 });
  const responses = [unavailable, ready];
  const methods = [];
  globalThis.fetch = async (_url, init = {}) => {
    methods.push(init.method);
    return responses.shift().response;
  };
  try {
    await waitForReady(1, Date.now() + 1000);
    assert.deepEqual(methods, ["HEAD", "HEAD"]);
    assert.equal(unavailable.wasCancelled(), true);
    assert.equal(ready.wasCancelled(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForReady caps its retry delay at the remaining deadline", async () => {
  const originalFetch = globalThis.fetch;
  const unavailable = mockResponse({ ok: false, status: 503 });
  const delays = [];
  let now = 1000;
  globalThis.fetch = async () => unavailable.response;
  try {
    await assert.rejects(
      () =>
        waitForReady(1, 1040, {
          now: () => now,
          sleep: async (delay) => {
            delays.push(delay);
            now += delay;
          },
        }),
      /Gateway did not become ready/,
    );
    assert.deepEqual(delays, [40]);
    assert.equal(now, 1040);
    assert.equal(unavailable.wasCancelled(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
