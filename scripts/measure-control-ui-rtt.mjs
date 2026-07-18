import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function usage() {
  return [
    "Usage: node --import tsx scripts/measure-control-ui-rtt.mjs",
    "  --output-dir <dir>",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      args.outputDir = argv[(index += 1)];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.outputDir) {
    throw new Error(usage());
  }
  return args;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

async function loadOpenClawHelpers(repoRoot) {
  const requireFromOpenClaw = createRequire(path.join(repoRoot, "package.json"));
  const { chromium } = requireFromOpenClaw("playwright");
  const helperUrl = pathToFileURL(
    path.join(repoRoot, "ui/src/test-helpers/control-ui-e2e.ts"),
  ).href;
  const helpers = await import(helperUrl);
  return { chromium, ...helpers };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.env.OPENCLAW_REPO_ROOT
    ? path.resolve(process.env.OPENCLAW_REPO_ROOT)
    : process.cwd();
  const outputDir = path.resolve(args.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const startedAt = new Date();
  const {
    canRunPlaywrightChromium,
    chromium,
    installMockGateway,
    resolvePlaywrightChromiumExecutablePath,
    startControlUiE2eServer,
  } = await loadOpenClawHelpers(repoRoot);
  let server;
  let browser;
  let status = "fail";
  let details = "";
  let rttMeasurement;
  let events = [];

  try {
    const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
    if (!canRunPlaywrightChromium(chromiumExecutablePath)) {
      throw new Error(
        `Playwright Chromium is not installed at ${chromiumExecutablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a compatible browser.`,
      );
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      historyMessages: [
        {
          content: [{ text: "Ready for a Control UI RTT check.", type: "text" }],
          role: "assistant",
          timestamp: Date.now(),
        },
      ],
    });

    await page.goto(`${server.baseUrl}chat`);
    await page.getByText("Ready for a Control UI RTT check.").waitFor({ timeout: 10_000 });

    const prompt = "measure the control ui rtt surface";
    await page.locator(".agent-chat__composer-combobox textarea").fill(prompt);
    const requestStartedAt = new Date();
    await page.getByRole("button", { name: "Send message" }).click();
    const sendRequest = await gateway.waitForRequest("chat.send");
    const params = requireRecord(sendRequest.params, "chat.send params");
    const runId =
      typeof params.idempotencyKey === "string" && params.idempotencyKey
        ? params.idempotencyKey
        : sendRequest.id;
    await gateway.emitChatFinal({ runId, text: "Control UI RTT measured." });
    await page
      .locator("p")
      .filter({ hasText: "Control UI RTT measured." })
      .waitFor({ timeout: 10_000 });
    const responseObservedAt = new Date();
    rttMeasurement = {
      finalMatchedReplyRttMs: Math.max(0, responseObservedAt.getTime() - requestStartedAt.getTime()),
      requestStartedAt: requestStartedAt.toISOString(),
      responseObservedAt: responseObservedAt.toISOString(),
      method: "chat.send",
      source: "control-ui-visible-final",
    };
    events = await page.evaluate(() => {
      const app = document.querySelector("openclaw-app");
      return Array.isArray(app?.eventLogBuffer)
        ? app.eventLogBuffer
        : Array.isArray(app?.eventLog)
          ? app.eventLog
          : [];
    });
    events.unshift({
      event: "control-ui.rtt",
      payload: {
        method: "chat.send",
        ok: true,
        durationMs: rttMeasurement.finalMatchedReplyRttMs,
      },
    });
    status = "pass";
    details = "Control UI rendered final Gateway event";
    await context.close();
  } catch (error) {
    details = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  const finishedAt = new Date();
  await fs.writeFile(
    path.join(outputDir, "control-ui-events.json"),
    `${JSON.stringify(events, null, 2)}\n`,
  );
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
          providerMode: "mock-openai",
          scenarioIds: ["control-ui-qa-channel-image-roundtrip"],
        },
        scenarios: [
          {
            id: "control-ui-qa-channel-image-roundtrip",
            title: "Control UI mocked Gateway RTT",
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
    throw new Error(details || "Control UI RTT measurement failed");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
