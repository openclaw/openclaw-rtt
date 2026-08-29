function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReady(port, deadlineMs) {
  const url = `http://127.0.0.1:${port}/readyz`;
  let lastError;
  while (Date.now() < deadlineMs) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(remainingMs) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw new Error(
    `Gateway did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
