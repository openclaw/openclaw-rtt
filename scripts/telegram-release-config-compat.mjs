const LEGACY_CONFIG_CUTOFF = {
  major: 2026,
  minor: 7,
  patch: 2,
  prerelease: 4,
};

function parseExactPackageVersion(packageSpec) {
  const match =
    /^openclaw@(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-beta\.(?<prerelease>\d+))?$/u.exec(
      packageSpec ?? "",
    );
  if (!match?.groups) {
    return undefined;
  }
  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease:
      match.groups.prerelease === undefined
        ? Number.POSITIVE_INFINITY
        : Number(match.groups.prerelease),
  };
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch", "prerelease"]) {
    const difference = left[key] - right[key];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
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

export function adaptTelegramReleaseGatewayConfig(config, packageSpec) {
  const candidateVersion = parseExactPackageVersion(packageSpec);
  if (!candidateVersion || compareVersions(candidateVersion, LEGACY_CONFIG_CUTOFF) >= 0) {
    return config;
  }
  return {
    ...config,
    agents: legacyAgentsConfig(config.agents),
    memory: legacyMemoryConfig(config.memory),
  };
}
