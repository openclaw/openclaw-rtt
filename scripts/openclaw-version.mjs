const OPENCLAW_VERSION_RE =
  /^(?<major>[0-9]{4})\.(?<minor>[1-9][0-9]*)\.(?<patch>[1-9][0-9]*)(?:(?:-beta\.(?<beta>[1-9][0-9]*))|(?:-(?<post>[1-9][0-9]*)))?$/u;

export function parseOpenClawVersion(version) {
  const match = OPENCLAW_VERSION_RE.exec(version);
  if (!match?.groups) {
    return undefined;
  }

  const kind = match.groups.beta ? "beta" : match.groups.post ? "post" : "stable";
  return {
    version,
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    kind,
    releaseNumber: Number(match.groups.beta ?? match.groups.post ?? 0),
  };
}

function versionOrder(version) {
  const parsed = parseOpenClawVersion(version);
  if (!parsed) {
    return undefined;
  }
  const releaseRank = parsed.kind === "beta" ? 0 : parsed.kind === "stable" ? 1 : 2;
  return [parsed.major, parsed.minor, parsed.patch, releaseRank, parsed.releaseNumber];
}

export function compareOpenClawVersions(left, right) {
  const leftParts = versionOrder(left);
  const rightParts = versionOrder(right);
  if (!leftParts || !rightParts) {
    throw new Error(`Cannot compare unsupported versions: ${left}, ${right}`);
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function isStableOpenClawVersion(version) {
  const parsed = parseOpenClawVersion(version);
  return parsed?.kind === "stable" || parsed?.kind === "post";
}

export function isOpenClawReleaseSpec(spec) {
  return (
    typeof spec === "string" &&
    spec.startsWith("openclaw@") &&
    parseOpenClawVersion(spec.slice("openclaw@".length)) !== undefined
  );
}
