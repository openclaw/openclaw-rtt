import { pathToFileURL } from "node:url";

const LEGACY_CONFIG_CUTOFF = {
  major: 2026,
  minor: 7,
  patch: 2,
  releaseRank: 0,
  releaseNumber: 4,
};

function parseExactPackageVersion(packageSpec) {
  const match =
    /^openclaw@(?<version>(?<major>[0-9]{4})\.(?<minor>[1-9][0-9]*)\.(?<patch>[1-9][0-9]*)(?:(?:-beta\.(?<beta>[1-9][0-9]*))|(?:-(?<post>[1-9][0-9]*)))?)$/u.exec(
      packageSpec ?? "",
    );
  if (!match?.groups) {
    return undefined;
  }
  return {
    version: match.groups.version,
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    releaseRank: match.groups.beta ? 0 : match.groups.post ? 2 : 1,
    releaseNumber: Number(match.groups.beta ?? match.groups.post ?? 0),
  };
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch", "releaseRank", "releaseNumber"]) {
    const difference = left[key] - right[key];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function resolveReleaseAuthRuntimePath(packageSpec, runtimePath) {
  return parseExactPackageVersion(packageSpec) && typeof runtimePath === "string" && runtimePath.trim()
    ? runtimePath
    : undefined;
}

export async function resolveReleaseAuthRuntime(packageSpec, runtimePath) {
  const resolvedPath = resolveReleaseAuthRuntimePath(packageSpec, runtimePath);
  return resolvedPath ? await import(pathToFileURL(resolvedPath).href) : undefined;
}

function legacyMemoryConfig(memory) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    return memory;
  }
  return Object.fromEntries(
    ["backend", "citations", "qmd"]
      .filter((key) => memory[key] !== undefined)
      .map((key) => [key, memory[key]]),
  );
}

function legacyAgentsConfig(agents) {
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return agents;
  }
  const { entries, ...legacyAgents } = agents;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return legacyAgents;
  }
  return {
    ...legacyAgents,
    list: Object.entries(entries).map(([id, entry]) => ({
      ...(entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {}),
      id,
    })),
  };
}

export function adaptReleaseGatewayConfig(config, packageSpec) {
  const candidateVersion = parseExactPackageVersion(packageSpec);
  if (!candidateVersion) {
    return config;
  }
  const legacyConfig = compareVersions(candidateVersion, LEGACY_CONFIG_CUTOFF) < 0;
  return {
    ...config,
    meta: {
      ...config.meta,
      lastTouchedVersion: candidateVersion.version,
    },
    ...(legacyConfig
      ? {
          agents: legacyAgentsConfig(config.agents),
          memory: legacyMemoryConfig(config.memory),
        }
      : {}),
  };
}
