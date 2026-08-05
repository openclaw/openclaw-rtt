import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 10_000;
const WARMUP_TIMEOUT_MS = 30_000;

function usage() {
  return [
    "Usage: node --import tsx scripts/measure-rpc-rtt.mjs",
    "  --output-dir <dir>",
    "  [--repo-root <openclaw-repo>]",
    "  [--iterations <count>]",
    "  [--warmups <count>]",
    "  [--methods <comma-separated-methods>]",
  ].join("\n");
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = { iterations: 10, methods: ["health", "config.get"], warmups: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      args.outputDir = argv[(index += 1)];
      continue;
    }
    if (arg === "--repo-root") {
      args.repoRoot = argv[(index += 1)];
      continue;
    }
    if (arg === "--iterations") {
      args.iterations = parsePositiveInteger(argv[(index += 1)], "iterations");
      continue;
    }
    if (arg === "--warmups") {
      args.warmups = parseNonNegativeInteger(argv[(index += 1)], "warmups");
      continue;
    }
    if (arg === "--methods") {
      args.methods = argv[(index += 1)]
        .split(",")
        .map((method) => method.trim())
        .filter(Boolean);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.outputDir || args.methods.length === 0) {
    throw new Error(usage());
  }
  return args;
}

function quantile(sorted, q) {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

function stats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: sorted.length ? Math.round(total / sorted.length) : undefined,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    maxMs: sorted.at(-1),
  };
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.close(resolve);
  });
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a loopback port.");
  }
  return address.port;
}

export function resolveOpenClawLaunch(repoRoot) {
  // The workflow builds once before measurement. Bypass the mutable source runner so
  // the timed probe uses that exact dist and cannot refresh plugin inputs at startup.
  return {
    command: process.execPath,
    args: [path.join(repoRoot, "openclaw.mjs")],
  };
}

export async function prepareBenchmarkConfig(tempDir) {
  const configPath = path.join(tempDir, "openclaw.json");
  // Local RPC RTT must not include hosted model-catalog network latency.
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ models: { catalogRefresh: { enabled: false } } }, null, 2)}\n`,
  );
  return configPath;
}

async function waitForReady(port, deadlineMs, { signal } = {}) {
  const url = `http://127.0.0.1:${port}/readyz`;
  let lastError;
  while (Date.now() < deadlineMs) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      lastError = error;
    }
    await wait(150, undefined, { signal });
  }
  throw new Error(
    `Gateway did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function spawnGateway({ repoRoot, outputDir, tempDir, configPath, port, token }) {
  const stdoutPath = path.join(outputDir, "gateway.stdout.log");
  const stderrPath = path.join(outputDir, "gateway.stderr.log");
  const stderrOffset = (await fs.stat(stderrPath).catch(() => ({ size: 0 }))).size;
  const stdout = await fs.open(stdoutPath, "a");
  const stderr = await fs.open(stderrPath, "a");
  const launcher = resolveOpenClawLaunch(repoRoot);
  try {
    const child = spawn(
      launcher.command,
      [
        ...launcher.args,
        "gateway",
        "run",
        "--port",
        String(port),
        "--bind",
        "loopback",
        "--allow-unconfigured",
        "--auth",
        "token",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: path.join(tempDir, "home"),
          XDG_CONFIG_HOME: path.join(tempDir, "xdg-config"),
          XDG_CACHE_HOME: path.join(tempDir, "xdg-cache"),
          XDG_DATA_HOME: path.join(tempDir, "xdg-data"),
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_STATE_DIR: path.join(tempDir, "state"),
          OPENCLAW_GATEWAY_TOKEN: token,
          OPENCLAW_SKIP_CHANNELS: "1",
          OPENCLAW_SKIP_PROVIDERS: "1",
          OPENCLAW_TEST_FAST: "1",
          OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: "1",
        },
        stdio: ["ignore", stdout.fd, stderr.fd],
      },
    );
    return { child, stderrOffset, stderrPath };
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }
}

async function readGatewayStderr(gateway) {
  const contents = await fs.readFile(gateway.stderrPath);
  return contents.subarray(gateway.stderrOffset).toString("utf8");
}

export class GatewayExitedBeforeReadyError extends Error {
  constructor({ code, signal, stderr, cause }) {
    const exit = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    const diagnostic = stderr.trim();
    super(
      `Gateway exited before readiness (${exit})${diagnostic ? `:\n${diagnostic}` : ""}`,
      cause ? { cause } : undefined,
    );
    this.name = "GatewayExitedBeforeReadyError";
    this.code = code;
    this.signal = signal;
    this.stderr = stderr;
  }
}

export async function waitForGatewayReady(
  gateway,
  port,
  deadlineMs,
  { readGatewayStderrFn = readGatewayStderr, waitForReadyFn = waitForReady } = {},
) {
  const readinessAbort = new AbortController();
  const exitAbort = new AbortController();
  const ready = waitForReadyFn(port, deadlineMs, { signal: readinessAbort.signal }).then(
    () => ({ kind: "ready" }),
    (error) => ({ error, kind: "ready-error" }),
  );
  const exited =
    gateway.child.exitCode !== null || gateway.child.signalCode !== null
      ? Promise.resolve({
          kind: "exit",
          result: { code: gateway.child.exitCode, signal: gateway.child.signalCode },
        })
      : once(gateway.child, "exit", { signal: exitAbort.signal }).then(
          ([code, signal]) => ({ kind: "exit", result: { code, signal } }),
          (error) => ({ error, kind: "exit-error" }),
        );
  const outcome = await Promise.race([ready, exited]);
  if (outcome.kind === "ready") {
    exitAbort.abort();
    return;
  }
  if (outcome.kind === "ready-error") {
    exitAbort.abort();
    throw outcome.error;
  }
  readinessAbort.abort(new Error("Gateway process exited before readiness."));
  const stderr = await readGatewayStderrFn(gateway);
  throw new GatewayExitedBeforeReadyError({
    code: outcome.result?.code ?? gateway.child.exitCode,
    signal: outcome.result?.signal ?? gateway.child.signalCode,
    stderr,
    cause: outcome.error,
  });
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  try {
    await Promise.race([
      exit,
      wait(5_000).then(() => {
        child.kill("SIGKILL");
      }),
    ]);
  } catch {
    child.kill("SIGKILL");
  }
}

async function loadGatewayClient(repoRoot) {
  const clientUrl = pathToFileURL(path.join(repoRoot, "packages/gateway-client/src/client.ts")).href;
  return await import(clientUrl);
}

async function connectGateway({ GatewayClient, port, token }) {
  let client;
  const connected = new Promise((resolve, reject) => {
    client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token,
      clientName: "gateway-client",
      clientDisplayName: "OpenClaw RTT RPC probe",
      clientVersion: "openclaw-rtt",
      platform: process.platform,
      mode: "backend",
      role: "operator",
      scopes: ["operator.admin"],
      requestTimeoutMs: 10_000,
      connectChallengeTimeoutMs: 10_000,
      env: {
        ...process.env,
        OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: "1",
      },
      onHelloOk: resolve,
      onConnectError: reject,
    });
    client.start();
  });
  await connected;
  return client;
}

async function timeGatewayRequest(client, method, timeoutMs) {
  const startedAt = performance.now();
  await client.request(method, method === "config.get" ? {} : undefined, { timeoutMs });
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export async function measureMethod(client, method, iterations, warmups) {
  const warmupSamples = [];
  const samples = [];
  const failures = [];
  for (let index = 0; index < warmups; index += 1) {
    try {
      // Gateway readiness precedes background runtime pre-warming. Give only the
      // untimed warmup enough budget to cross that startup boundary.
      warmupSamples.push(await timeGatewayRequest(client, method, WARMUP_TIMEOUT_MS));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (let index = 0; index < iterations; index += 1) {
    try {
      samples.push(await timeGatewayRequest(client, method, REQUEST_TIMEOUT_MS));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { failures, method, samples, stats: stats(samples), warmupSamples };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot ?? process.env.OPENCLAW_REPO_ROOT ?? process.cwd());
  const outputDir = path.resolve(args.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(outputDir, "..", ".rpc-rtt-"));
  const configPath = await prepareBenchmarkConfig(tempDir);
  const token = `rtt-${randomUUID()}`;
  const port = await findFreePort();
  const startedAt = new Date();
  let gatewayChild;
  let client;
  let status = "fail";
  let details = "";
  let connectMs;
  const methodResults = [];

  try {
    const gateway = await spawnGateway({ repoRoot, outputDir, tempDir, configPath, port, token });
    gatewayChild = gateway.child;
    await waitForGatewayReady(gateway, port, Date.now() + 45_000);
    const { GatewayClient } = await loadGatewayClient(repoRoot);
    const connectStartedAt = performance.now();
    client = await connectGateway({ GatewayClient, port, token });
    connectMs = Math.max(0, Math.round(performance.now() - connectStartedAt));
    for (const method of args.methods) {
      methodResults.push(await measureMethod(client, method, args.iterations, args.warmups));
    }
    const failed = methodResults.flatMap((result) => result.failures);
    status = failed.length === 0 ? "pass" : "fail";
    details = JSON.stringify({
      connectMs,
      iterations: args.iterations,
      methods: args.methods,
      warmups: args.warmups,
      overall: stats(methodResults.flatMap((result) => result.samples)),
      byMethod: Object.fromEntries(
        methodResults.map((result) => [
          result.method,
          {
            failures: result.failures.length,
            warmupSamples: result.warmupSamples,
            ...result.stats,
          },
        ]),
      ),
      ...(failed.length > 0 ? { failures: failed } : {}),
    });
  } catch (error) {
    details = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await client?.stopAndWait?.({ timeoutMs: 250 }).catch(() => {});
    await stopGateway(gatewayChild);
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }

  const finishedAt = new Date();
  const allSamples = methodResults.flatMap((result) => result.samples);
  const overall = stats(allSamples);
  const rttMeasurement =
    typeof overall.p50Ms === "number"
      ? {
          finalMatchedReplyRttMs: overall.p50Ms,
          method: args.methods.join(","),
          requestStartedAt: startedAt.toISOString(),
          responseObservedAt: finishedAt.toISOString(),
          source: "gateway-rpc",
        }
      : undefined;
  const events = methodResults.flatMap((result) =>
    result.samples.map((durationMs) => ({
      event: "gateway-rpc",
      payload: {
        durationMs,
        kind: "gateway-rpc",
        method: result.method,
        ok: true,
      },
    })),
  );

  await fs.writeFile(path.join(outputDir, "rpc-events.json"), `${JSON.stringify(events, null, 2)}\n`);
  await fs.writeFile(
    path.join(outputDir, "qa-suite-summary.json"),
    `${JSON.stringify(
      {
        counts: {
          total: 1,
          passed: status === "pass" ? 1 : 0,
          failed: status === "pass" ? 0 : 1,
        },
        run: {
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          providerMode: "gateway-rpc",
          scenarioIds: ["rpc-gateway-smoke"],
        },
        metrics: {
          gatewayRpcConnectMs: connectMs,
          gatewayRpcOverall: overall,
        },
        scenarios: [
          {
            id: "rpc-gateway-smoke",
            title: "Gateway RPC loopback smoke",
            status,
            details,
            ...(rttMeasurement ? { rttMeasurement } : {}),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  if (status !== "pass") {
    throw new Error(details || "Gateway RPC RTT measurement failed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
