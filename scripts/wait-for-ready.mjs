function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReady(port, deadlineMs, { now = Date.now, sleep = wait } = {}) {
  const url = `http://127.0.0.1:${port}/readyz`;
  let lastError;
  while (now() < deadlineMs) {
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) {
      break;
    }
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(remainingMs),
      });
      try {
        if (response.ok) {
          return;
        }
        lastError = new Error(`${url} returned ${response.status}`);
      } finally {
        await response.body?.cancel();
      }
    } catch (error) {
      lastError = error;
    }
    const retryDelayMs = Math.min(150, Math.max(0, deadlineMs - now()));
    if (retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `Gateway did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
