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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function legacyMemoryConfig(memory, moveSearchToAgentDefaults) {
  if (!isRecord(memory) || !moveSearchToAgentDefaults) {
    return memory;
  }
  const { search: _search, ...legacyMemory } = memory;
  return legacyMemory;
}

function legacyAgentDefaults(defaults, memorySearch) {
  if (defaults === undefined) {
    return memorySearch === undefined ? undefined : { memorySearch };
  }
  if (!isRecord(defaults)) {
    return defaults;
  }

  const { mediaModels, modelPolicy, ...legacyDefaults } = defaults;
  const adaptedDefaults = {
    ...legacyDefaults,
    ...(!isRecord(modelPolicy) && modelPolicy !== undefined ? { modelPolicy } : {}),
    ...(memorySearch === undefined ? {} : { memorySearch }),
  };
  if (!isRecord(mediaModels)) {
    return mediaModels === undefined
      ? adaptedDefaults
      : {
          ...adaptedDefaults,
          mediaModels,
        };
  }

  const { image, video, music, ...unknownMediaModels } = mediaModels;
  return {
    ...adaptedDefaults,
    ...(image === undefined ? {} : { imageGenerationModel: image }),
    ...(video === undefined ? {} : { videoGenerationModel: video }),
    ...(music === undefined ? {} : { musicGenerationModel: music }),
    ...(Object.keys(unknownMediaModels).length === 0
      ? {}
      : { mediaModels: unknownMediaModels }),
  };
}

function legacyAgentEntry(entry) {
  const { memory, modelPolicy, ...legacyEntry } = entry;
  const adaptedEntry = {
    ...legacyEntry,
    ...(!isRecord(modelPolicy) && modelPolicy !== undefined ? { modelPolicy } : {}),
  };
  if (!isRecord(memory)) {
    return memory === undefined ? adaptedEntry : { ...adaptedEntry, memory };
  }
  if (!Object.hasOwn(memory, "search")) {
    return { ...adaptedEntry, memory };
  }

  const { search, ...unknownMemory } = memory;
  return {
    ...adaptedEntry,
    ...(search === undefined ? {} : { memorySearch: search }),
    ...(Object.keys(unknownMemory).length === 0 ? {} : { memory: unknownMemory }),
  };
}

function legacyAgentsConfig(agents, memorySearch) {
  if (agents === undefined) {
    return memorySearch === undefined ? undefined : { defaults: { memorySearch } };
  }
  if (!isRecord(agents)) {
    return agents;
  }

  const defaults = legacyAgentDefaults(agents.defaults, memorySearch);
  const withLegacyDefaults = {
    ...agents,
    ...(defaults === undefined ? {} : { defaults }),
  };
  if (!isRecord(agents.entries)) {
    return withLegacyDefaults;
  }
  const entries = Object.entries(agents.entries);
  if (entries.some(([, entry]) => !isRecord(entry))) {
    return withLegacyDefaults;
  }

  const { entries: _entries, ...legacyAgents } = withLegacyDefaults;
  return {
    ...legacyAgents,
    list: entries.map(([id, entry]) => ({
      ...legacyAgentEntry(entry),
      id,
    })),
  };
}

function legacyReleaseConfig(config) {
  const memorySearch =
    isRecord(config.memory) && Object.hasOwn(config.memory, "search")
      ? config.memory.search
      : undefined;
  const moveSearchToAgentDefaults =
    memorySearch !== undefined &&
    (config.agents === undefined ||
      (isRecord(config.agents) &&
        (config.agents.defaults === undefined || isRecord(config.agents.defaults))));
  const agents = legacyAgentsConfig(
    config.agents,
    moveSearchToAgentDefaults ? memorySearch : undefined,
  );
  const memory = legacyMemoryConfig(config.memory, moveSearchToAgentDefaults);

  const synthesizeAgents = !Object.hasOwn(config, "agents") && agents !== undefined;
  if (!Object.hasOwn(config, "agents") && !Object.hasOwn(config, "memory") && !synthesizeAgents) {
    return config;
  }
  return {
    ...config,
    ...(Object.hasOwn(config, "agents") || synthesizeAgents ? { agents } : {}),
    ...(Object.hasOwn(config, "memory") ? { memory } : {}),
  };
}

function stampCandidateVersion(config, version) {
  if (!isRecord(config)) {
    return config;
  }
  return {
    ...config,
    meta: {
      ...(isRecord(config.meta) ? config.meta : {}),
      lastTouchedVersion: version,
    },
  };
}

export function adaptReleaseGatewayConfig(config, packageSpec) {
  const candidateVersion = parseExactPackageVersion(packageSpec);
  if (!candidateVersion || !isRecord(config)) {
    return config;
  }
  const legacyConfig = compareVersions(candidateVersion, LEGACY_CONFIG_CUTOFF) < 0;
  return stampCandidateVersion(
    legacyConfig ? legacyReleaseConfig(config) : config,
    candidateVersion.version,
  );
}
