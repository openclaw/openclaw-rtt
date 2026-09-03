function isRunningChild(child) {
  return (
    child &&
    Number.isInteger(child.pid) &&
    child.pid > 0 &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

function signalAndWait(child, signal, timeoutMs) {
  if (!isRunningChild(child)) {
    return Promise.resolve("exited");
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(outcome);
    };
    const onExit = () => finish("exited");
    // ChildProcess errors do not prove termination; keep waiting for exit or deadline.
    const onError = () => undefined;

    child.once("exit", onExit);
    child.on("error", onError);
    if (!isRunningChild(child)) {
      finish("exited");
      return;
    }

    timer = setTimeout(() => finish("timeout"), timeoutMs);
    try {
      child.kill(signal);
    } catch {
      // A signal error does not prove exit. Keep the deadline active so
      // TERM failures still escalate and the final KILL wait stays bounded.
    }
  });
}

export async function stopGateway(child, { waitMs = 5_000, killWaitMs = 5_000 } = {}) {
  if (!isRunningChild(child)) {
    return;
  }

  const termOutcome = await signalAndWait(child, "SIGTERM", waitMs);
  if (termOutcome !== "timeout") {
    return;
  }

  await signalAndWait(child, "SIGKILL", killWaitMs);
}
