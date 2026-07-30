import fs from "node:fs/promises";
import path from "node:path";

const resultAnchor = `    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
      expectedTextIncludes: run.expectedTextIncludes,
      message: matched.message,
    });
    return { details: "reply matched" };`;

const measuredResult = `    discordQaScenarioSupport.testing.assertDiscordScenarioReply({
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

function usage() {
  return "Usage: node scripts/patch-openclaw-discord-rtt-harness.mjs <openclaw-repo-root>";
}

function countOccurrences(contents, value) {
  return contents.split(value).length - 1;
}

async function main() {
  const [repoRoot, ...extraArgs] = process.argv.slice(2);
  if (!repoRoot || extraArgs.length > 0) {
    throw new Error(usage());
  }

  const scenarioPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/discord/scenario-runtime.ts",
  );
  const runtimePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/discord/discord-live.runtime.ts",
  );
  const [scenarioSource, runtimeSource] = await Promise.all([
    fs.readFile(scenarioPath, "utf8"),
    fs.readFile(runtimePath, "utf8"),
  ]);
  if (countOccurrences(runtimeSource, "  computeDiscordRttMs,") !== 1) {
    throw new Error(`Unsupported Discord RTT helper contract in ${runtimePath}`);
  }

  const anchorCount = countOccurrences(scenarioSource, resultAnchor);
  const replacementCount = countOccurrences(scenarioSource, measuredResult);
  if (replacementCount === 1 && anchorCount === 0) {
    process.stdout.write("Discord RTT measurement contract already patched\n");
    return;
  }
  if (replacementCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Discord RTT scenario contract in ${scenarioPath}`);
  }

  await fs.writeFile(scenarioPath, scenarioSource.replace(resultAnchor, measuredResult));
  process.stdout.write("patched Discord RTT measurement contract\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
