import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { readRows } from "./read-rows.mjs";

const execFileAsync = promisify(execFile);
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;

function parseStableVersion(version) {
  const match = STABLE_VERSION_RE.exec(version);
  if (!match) {
    return undefined;
  }
  return match.slice(1).map(Number);
}

function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) {
    throw new Error(`Cannot compare non-stable versions: ${left}, ${right}`);
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

async function npmVersions() {
  const { stdout } = await execFileAsync("npm", ["view", "openclaw", "versions", "--json"], {
    timeout: 30_000,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("npm view openclaw versions --json must return an array.");
  }
  return parsed;
}

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const versions = await npmVersions();
const latestStable = versions
  .filter((version) => typeof version === "string" && parseStableVersion(version))
  .sort(compareStableVersions)
  .at(-1);

if (!latestStable) {
  throw new Error("No stable openclaw npm versions found.");
}

const spec = `openclaw@${latestStable}`;
const rows = await readRows();
const alreadyMeasured = rows.some(
  (row) => row.package.spec === spec && row.package.version === latestStable,
);

await writeOutput({
  version: latestStable,
  spec,
  should_run: alreadyMeasured ? "false" : "true",
  reason: alreadyMeasured ? "already-measured" : "new-stable-release",
});
