export async function stopGateway(child, { waitMs = 5_000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  try {
    const winner = await Promise.race([
      exit.then(() => "exit"),
      timeout.then(() => "timeout"),
    ]);
    if (winner === "timeout") {
      child.kill("SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  } finally {
    clearTimeout(timer);
  }
}
