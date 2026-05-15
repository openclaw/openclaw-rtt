import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { readRows } from "./read-rows.mjs";

const execFileAsync = promisify(execFile);
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;

function parseVersion(version) {
  const stableMatch = STABLE_VERSION_RE.exec(version);
  if (stableMatch) {
    return [...stableMatch.slice(1).map(Number), Number.MAX_SAFE_INTEGER];
  }

  const betaMatch = BETA_VERSION_RE.exec(version);
  if (betaMatch) {
    return betaMatch.slice(1).map(Number);
  }

  return undefined;
}

function parseStableRelease(version) {
  const match = STABLE_VERSION_RE.exec(version);
  if (!match) {
    return undefined;
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    throw new Error(`Cannot compare unsupported versions: ${left}, ${right}`);
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

function latestMeasuredStable(rows) {
  const latestStable = rows
    .map((row) => row.package.version)
    .filter((version) => typeof version === "string" && parseStableRelease(version))
    .sort(compareVersions)
    .at(-1);

  if (!latestStable) {
    throw new Error("No measured stable openclaw releases found.");
  }
  return latestStable;
}

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const rows = await readRows();
const anchor = latestMeasuredStable(rows);
const measured = new Set(rows.map((row) => `${row.package.spec}\0${row.package.version}`));
const queue = (await npmVersions())
  .filter((version) => typeof version === "string" && parseVersion(version))
  .filter((version) => compareVersions(version, anchor) > 0)
  .map((version) => ({ version, spec: `openclaw@${version}` }))
  .filter((pkg) => !measured.has(`${pkg.spec}\0${pkg.version}`))
  .sort((left, right) => compareVersions(left.version, right.version));

await writeOutput({
  anchor,
  count: String(queue.length),
  specs: queue.map((pkg) => pkg.spec).join(" "),
  versions: queue.map((pkg) => pkg.version).join(" "),
  should_run: queue.length > 0 ? "true" : "false",
  reason: queue.length > 0 ? "new-release-versions" : "no-new-release-versions",
});
