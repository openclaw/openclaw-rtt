import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { listSurfaceRttSurfaces } from "./surface-rtt-config.mjs";
import { readSurfaceRows } from "./surface-storage.mjs";

const execFileAsync = promisify(execFile);
const RELEASE_SPEC_RE =
  /^openclaw@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(?:-beta\.[1-9][0-9]*)?$/u;
const STABLE_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)$/u;
const BETA_VERSION_RE = /^([0-9]{4})\.([1-9][0-9]*)\.([1-9][0-9]*)-beta\.([1-9][0-9]*)$/u;
const DEFAULT_SURFACES = ["control-ui"];
const DEFAULT_VERSION_LIMIT = 4;
const RELEASE_SURFACES = new Set(["control-ui"]);

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

function readList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[\s,]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readListEnv(name) {
  return readList(process.env[name]);
}

function readPositiveIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

async function npmVersions() {
  const fixture = process.env.INPUT_AVAILABLE_VERSIONS;
  if (fixture) {
    return new Set(readList(fixture).filter((version) => parseVersion(version)));
  }
  const { stdout } = await execFileAsync("npm", ["view", "openclaw", "versions", "--json"], {
    timeout: 30_000,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("npm view openclaw versions --json must return an array.");
  }
  return new Set(parsed.filter((version) => typeof version === "string" && parseVersion(version)));
}

function releaseRows(rows) {
  return rows.filter(
    (row) =>
      typeof row.package?.spec === "string" &&
      RELEASE_SPEC_RE.test(row.package.spec) &&
      typeof row.package?.version === "string" &&
      parseVersion(row.package.version),
  );
}

function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    return fs.appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const surfaceConfig = new Map(listSurfaceRttSurfaces().map((surface) => [surface.id, surface]));
const requestedSurfaces = readListEnv("INPUT_SURFACES");
const surfaceIds = requestedSurfaces.length === 0 ? DEFAULT_SURFACES : requestedSurfaces;
for (const surfaceId of surfaceIds) {
  if (!surfaceConfig.has(surfaceId)) {
    throw new Error(`Unknown surface: ${surfaceId}`);
  }
  if (!RELEASE_SURFACES.has(surfaceId)) {
    throw new Error(`Surface ${surfaceId} is not supported by release surface RTT.`);
  }
}

const availableVersions = await npmVersions();
const explicitVersions = readListEnv("INPUT_VERSIONS");
const versionLimit = readPositiveIntegerEnv("INPUT_VERSION_LIMIT", DEFAULT_VERSION_LIMIT);
const rowsBySurface = new Map();
for (const surfaceId of surfaceIds) {
  rowsBySurface.set(surfaceId, releaseRows(await readSurfaceRows(surfaceId)));
}
const measured = new Set(
  [...rowsBySurface.entries()].flatMap(([surfaceId, rows]) =>
    rows
      .filter((row) => row.run?.status === "pass")
      .map((row) => `${surfaceId}\0${row.package?.spec}\0${row.package?.version}`),
  ),
);

const queue = [];
for (const surfaceId of surfaceIds) {
  const surface = surfaceConfig.get(surfaceId);
  const surfaceRows = rowsBySurface.get(surfaceId) ?? [];
  const measuredVersions = surfaceRows
    .filter((row) => row.run?.status === "pass")
    .map((row) => row.package.version)
    .filter((version) => parseVersion(version));
  const latestMeasured = measuredVersions.sort(compareVersions).at(-1);
  const versions =
    explicitVersions.length > 0
      ? explicitVersions
      : [...availableVersions]
          .filter((version) => !latestMeasured || compareVersions(version, latestMeasured) > 0)
          .sort(compareVersions)
          .slice(0, versionLimit);

  for (const version of versions) {
    if (!parseVersion(version)) {
      throw new Error(`Unsupported version: ${version}`);
    }
    if (!availableVersions.has(version)) {
      throw new Error(`openclaw@${version} was not found on npm.`);
    }
    const spec = `openclaw@${version}`;
    const alreadyMeasured = measured.has(`${surfaceId}\0${spec}\0${version}`);
    if (alreadyMeasured && explicitVersions.length === 0) {
      continue;
    }
    queue.push({
      surface: surfaceId,
      label: surface.label,
      scenario: surface.defaultScenario,
      spec,
      version,
      tag: `v${version}`,
    });
  }
}

queue.sort((left, right) => {
  const versionDiff = compareVersions(left.version, right.version);
  if (versionDiff !== 0) {
    return versionDiff;
  }
  return left.surface.localeCompare(right.surface);
});

await writeOutput({
  count: String(queue.length),
  matrix: JSON.stringify(queue),
  reason:
    queue.length === 0
      ? "no-missing-surface-release-versions"
      : explicitVersions.length > 0
        ? "explicit-surface-release-versions"
        : "missing-surface-release-versions",
  should_run: queue.length > 0 ? "true" : "false",
  surfaces: [...new Set(queue.map((pkg) => pkg.surface))].join(" "),
  versions: [...new Set(queue.map((pkg) => pkg.version))].join(" "),
});
