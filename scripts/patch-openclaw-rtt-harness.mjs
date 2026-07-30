import fs from "node:fs/promises";
import path from "node:path";

const discordResultAnchor = `    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
      expectedTextIncludes: run.expectedTextIncludes,
      message: matched.message,
    });
    return { details: "reply matched" };`;
const measuredDiscordResult = `    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
      expectedTextIncludes: run.expectedTextIncludes,
      message: matched.message,
    });
    const requestStartedAt = sent.timestamp;
    const responseObservedAt = matched.message.timestamp;
    const rttMs = discordQaScenarioSupport.testing.computeDiscordRttMs(
      requestStartedAt,
      responseObservedAt,
    );
    return {
      details: "reply matched",
      ...(requestStartedAt === undefined ? {} : { requestStartedAt }),
      ...(responseObservedAt === undefined ? {} : { responseObservedAt }),
      ...(rttMs === undefined || requestStartedAt === undefined || responseObservedAt === undefined
        ? {}
        : {
            rttMs,
            rttMeasurement: {
              finalMatchedReplyRttMs: rttMs,
              requestStartedAt,
              responseObservedAt,
              source: "request-to-observed-message",
            },
          }),
    };`;

const slackResultAnchor = `    const responseObservedAt = new Date(reply.observedAt);
    const rttMs = responseObservedAt.getTime() - requestStartedAt.getTime();
    return {
      details: [\`reply matched in \${rttMs}ms\`, beforeRunDetails, observedDetails, afterReplyDetails]
        .filter(Boolean)
        .join("; "),
    };`;
const measuredSlackResult = `    const responseObservedAt = new Date(reply.observedAt);
    const rttMs = responseObservedAt.getTime() - requestStartedAt.getTime();
    return {
      details: [\`reply matched in \${rttMs}ms\`, beforeRunDetails, observedDetails, afterReplyDetails]
        .filter(Boolean)
        .join("; "),
      rttMs,
      requestStartedAt: requestStartedAt.toISOString(),
      responseObservedAt: responseObservedAt.toISOString(),
      rttMeasurement: {
        finalMatchedReplyRttMs: rttMs,
        requestStartedAt: requestStartedAt.toISOString(),
        responseObservedAt: responseObservedAt.toISOString(),
        source: "request-to-observed-message",
      },
    };`;

const flowResultAnchor =
  "  return await params.api.runScenario(params.scenarioTitle, steps);";
const measuredFlowResult = `  const scenarioResult = await params.api.runScenario(params.scenarioTitle, steps);
  const moduleResult = vars.result;
  if (!isPlainObject(moduleResult)) {
    return scenarioResult;
  }
  const measurement = isPlainObject(moduleResult.rttMeasurement)
    ? moduleResult.rttMeasurement
    : undefined;
  const rttMs = measurement?.finalMatchedReplyRttMs ?? moduleResult.rttMs;
  return typeof rttMs === "number" && Number.isFinite(rttMs) && rttMs > 0
    ? { ...scenarioResult, timing: { rttMs } }
    : scenarioResult;`;

function usage() {
  return "Usage: node scripts/patch-openclaw-rtt-harness.mjs <openclaw-repo-root>";
}

function replaceExactlyOnce(contents, anchor, replacement, pathname, label) {
  const anchorCount = contents.split(anchor).length - 1;
  const replacementCount = contents.split(replacement).length - 1;
  if (replacementCount === 1 && anchorCount === 0) {
    return { contents, patched: false };
  }
  if (replacementCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported ${label} contract in ${pathname}`);
  }
  return {
    contents: contents.replace(anchor, replacement),
    patched: true,
  };
}

async function main() {
  const [repoRoot, ...extraArgs] = process.argv.slice(2);
  if (!repoRoot || extraArgs.length > 0) {
    throw new Error(usage());
  }

  const discordScenarioPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/discord/scenario-runtime.ts",
  );
  const discordRuntimePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/discord/discord-live.runtime.ts",
  );
  const slackScenarioPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/slack/scenario-runtime.ts",
  );
  const flowRunnerPath = path.resolve(repoRoot, "extensions/qa-lab/src/scenario-flow-runner.ts");
  const [discordScenarioSource, discordRuntimeSource, slackScenarioSource, flowRunnerSource] =
    await Promise.all([
      fs.readFile(discordScenarioPath, "utf8"),
      fs.readFile(discordRuntimePath, "utf8"),
      fs.readFile(slackScenarioPath, "utf8"),
      fs.readFile(flowRunnerPath, "utf8"),
    ]);
  if (discordRuntimeSource.split("  computeDiscordRttMs,").length - 1 !== 1) {
    throw new Error(`Unsupported Discord RTT helper contract in ${discordRuntimePath}`);
  }

  const discordPatch = replaceExactlyOnce(
    discordScenarioSource,
    discordResultAnchor,
    measuredDiscordResult,
    discordScenarioPath,
    "Discord RTT scenario",
  );
  const slackPatch = replaceExactlyOnce(
    slackScenarioSource,
    slackResultAnchor,
    measuredSlackResult,
    slackScenarioPath,
    "Slack RTT scenario",
  );
  const flowPatch = replaceExactlyOnce(
    flowRunnerSource,
    flowResultAnchor,
    measuredFlowResult,
    flowRunnerPath,
    "QA flow RTT projection",
  );
  const writes = [];
  if (discordPatch.patched) {
    writes.push(fs.writeFile(discordScenarioPath, discordPatch.contents));
  }
  if (slackPatch.patched) {
    writes.push(fs.writeFile(slackScenarioPath, slackPatch.contents));
  }
  if (flowPatch.patched) {
    writes.push(fs.writeFile(flowRunnerPath, flowPatch.contents));
  }
  await Promise.all(writes);

  const patchCount =
    Number(discordPatch.patched) + Number(slackPatch.patched) + Number(flowPatch.patched);
  process.stdout.write(
    patchCount > 0
      ? `patched ${patchCount} OpenClaw RTT evidence contracts\n`
      : "OpenClaw RTT evidence contracts already patched\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
