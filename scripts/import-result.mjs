import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.resolve("data/rtt.jsonl");
const RUNS_DIR = path.resolve("runs");

function usage() {
  return "Usage: node scripts/import-result.mjs <path-to-openclaw-result.json>";
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function validateResult(value) {
  const result = requireObject(value, "result");
  const packageInfo = requireObject(result.package, "result.package");
  const run = requireObject(result.run, "result.run");
  const mode = requireObject(result.mode, "result.mode");
  const rtt = requireObject(result.rtt, "result.rtt");

  requireString(packageInfo.spec, "result.package.spec");
  requireString(packageInfo.version, "result.package.version");
  requireString(run.id, "result.run.id");
  requireString(run.startedAt, "result.run.startedAt");
  requireString(run.finishedAt, "result.run.finishedAt");
  requireNumber(run.durationMs, "result.run.durationMs");
  if (run.status !== "pass" && run.status !== "fail") {
    throw new Error("result.run.status must be pass or fail.");
  }
  requireString(mode.providerMode, "result.mode.providerMode");
  if (!Array.isArray(mode.scenarios)) {
    throw new Error("result.mode.scenarios must be an array.");
  }
  if (rtt.canaryMs !== undefined) {
    requireNumber(rtt.canaryMs, "result.rtt.canaryMs");
  }
  if (rtt.mentionReplyMs !== undefined) {
    requireNumber(rtt.mentionReplyMs, "result.rtt.mentionReplyMs");
  }

  return result;
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function existingRunIds() {
  try {
    const text = await fs.readFile(DATA_PATH, "utf8");
    return new Set(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => validateResult(JSON.parse(line)).run.id),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error(usage());
  }

  const result = validateResult(await readJson(path.resolve(sourcePath)));
  const seen = await existingRunIds();
  if (seen.has(result.run.id)) {
    throw new Error(`Run already imported: ${result.run.id}`);
  }

  const runDir = path.join(RUNS_DIR, result.run.id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.appendFile(DATA_PATH, `${JSON.stringify(result)}\n`);
  process.stdout.write(`imported ${result.run.id}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
