import fs from "node:fs/promises";
import path from "node:path";

const STABLE_SUMMARY_FILENAME = "rtt-summary.json";
const SOURCE_METADATA_FILENAME = "rtt-summary-source.json";

class InvalidSummaryError extends Error {}

function usage() {
  return [
    "Usage: node scripts/select-channel-qa-summary.mjs",
    "  <output-dir> <canonical-filename> <channel> <scenario>",
  ].join("\n");
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidSummaryError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSummaryError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidSummaryError(`${label} must be a finite number.`);
  }
  return value;
}

function validateEvidenceSummary(value, scenarioId) {
  const summary = requireObject(value, "qa evidence");
  if (summary.kind !== "openclaw.qa.evidence-summary") {
    throw new InvalidSummaryError("qa evidence kind is not openclaw.qa.evidence-summary.");
  }
  requireString(summary.generatedAt, "qa evidence generatedAt");
  if (!Array.isArray(summary.entries)) {
    throw new InvalidSummaryError("qa evidence entries must be an array.");
  }
  const entry = summary.entries.find((item) => item?.test?.id === scenarioId);
  if (!entry) {
    throw new InvalidSummaryError(`qa evidence missing scenario ${scenarioId}.`);
  }
  const result = requireObject(entry.result, `qa evidence ${scenarioId} result`);
  return requireString(result.status, `qa evidence ${scenarioId} result status`);
}

function validateLegacySummary(value, scenarioId) {
  const summary = requireObject(value, "channel QA summary");
  requireString(summary.startedAt, "channel QA summary startedAt");
  requireString(summary.finishedAt, "channel QA summary finishedAt");
  const counts = requireObject(summary.counts, "channel QA summary counts");
  requireNumber(counts.total, "channel QA summary counts total");
  requireNumber(counts.passed, "channel QA summary counts passed");
  requireNumber(counts.failed, "channel QA summary counts failed");
  if (!Array.isArray(summary.scenarios)) {
    throw new InvalidSummaryError("channel QA summary scenarios must be an array.");
  }
  const scenario = summary.scenarios.find((item) => item?.id === scenarioId);
  if (!scenario) {
    throw new InvalidSummaryError(`channel QA summary missing scenario ${scenarioId}.`);
  }
  return requireString(scenario.status, `channel QA summary ${scenarioId} status`);
}

async function pathExists(pathname) {
  try {
    await fs.stat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeSourceMetadata(outputDir, metadata) {
  await fs.writeFile(
    path.join(outputDir, SOURCE_METADATA_FILENAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function metadata({ sourceFilename, schema, selection, scenario, status }) {
  return { sourceFilename, schema, selection, scenario, status };
}

async function selectSummary(outputDir, canonicalFilename, channel, scenario) {
  await fs.mkdir(outputDir, { recursive: true });
  const stableSummaryPath = path.join(outputDir, STABLE_SUMMARY_FILENAME);
  await fs.rm(stableSummaryPath, { force: true });

  const canonicalPath = path.join(outputDir, canonicalFilename);
  const legacyFilename = `${channel}-qa-summary.json`;
  const legacyPath = path.join(outputDir, legacyFilename);
  const hasCanonical = await pathExists(canonicalPath);
  const hasLegacy = await pathExists(legacyPath);

  if (!hasCanonical && !hasLegacy) {
    await writeSourceMetadata(
      outputDir,
      metadata({
        sourceFilename: null,
        schema: null,
        selection: "none",
        scenario,
        status: "missing",
      }),
    );
    return { code: 2, status: "missing" };
  }

  const sourceFilename = hasCanonical ? canonicalFilename : legacyFilename;
  const sourcePath = hasCanonical ? canonicalPath : legacyPath;
  const schema = hasCanonical ? "openclaw.qa.evidence-summary" : "channel-qa-summary";
  const selection = hasCanonical ? "canonical" : "legacy";

  try {
    const sourceBytes = await fs.readFile(sourcePath);
    let parsed;
    try {
      parsed = JSON.parse(sourceBytes.toString("utf8"));
    } catch (error) {
      throw new InvalidSummaryError(`invalid JSON: ${error.message}`);
    }
    const producerStatus = hasCanonical
      ? validateEvidenceSummary(parsed, scenario)
      : validateLegacySummary(parsed, scenario);
    const status = producerStatus === "pass" ? "pass" : "fail";
    await fs.copyFile(sourcePath, stableSummaryPath);
    await writeSourceMetadata(
      outputDir,
      metadata({ sourceFilename, schema, selection, scenario, status }),
    );
    return { code: 0, status };
  } catch (error) {
    if (!(error instanceof InvalidSummaryError)) {
      throw error;
    }
    await writeSourceMetadata(
      outputDir,
      metadata({
        sourceFilename,
        schema,
        selection,
        scenario,
        status: "invalid",
      }),
    );
    console.error(`${sourceFilename}: ${error.message}`);
    return { code: 3, status: "invalid" };
  }
}

async function main() {
  const [outputDir, canonicalFilename, channel, scenario, ...extra] = process.argv.slice(2);
  if (
    !outputDir ||
    !canonicalFilename ||
    path.basename(canonicalFilename) !== canonicalFilename ||
    !channel ||
    !scenario ||
    extra.length > 0
  ) {
    console.error(usage());
    return 1;
  }

  const result = await selectSummary(outputDir, canonicalFilename, channel, scenario);
  process.stdout.write(`${result.status}\n`);
  return result.code;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
