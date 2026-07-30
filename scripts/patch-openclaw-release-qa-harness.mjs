import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_ASSET_ROOT = path.dirname(fileURLToPath(import.meta.url));

const gatewayConfigWriteAnchor = `      await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
        encoding: "utf8",
        mode: 0o600,
      });`;
const adaptedGatewayConfigWrite = `      const releaseCompatibleConfig = (
        await import("./rtt-release-qa-config-compat.mjs")
      ).adaptReleaseGatewayConfig(cfg, process.env.OPENCLAW_QA_RELEASE_PACKAGE_SPEC);
      await fs.writeFile(configPath, \`\${JSON.stringify(releaseCompatibleConfig, null, 2)}\\n\`, {
        encoding: "utf8",
        mode: 0o600,
      });`;
const authStoreWriteAnchor = `export async function writeQaAuthProfiles(params: {
  agentDir: string;
  profiles: Record<string, QaAuthProfileCredential>;
  replace?: boolean;
}): Promise<void> {
  const existing = loadAuthProfileStoreWithoutExternalProfiles(params.agentDir, {
    inheritedAuthDir: params.agentDir,
  });
  const nextStore: AuthProfileStore = params.replace
    ? { version: 1, profiles: params.profiles as AuthProfileStore["profiles"] }
    : {
        ...existing,
        version: 1,
        profiles: { ...existing.profiles, ...params.profiles } as AuthProfileStore["profiles"],
      };
  saveAuthProfileStore(nextStore, params.agentDir, {
    filterExternalAuthProfiles: false,
    syncExternalCli: false,
  });
}`;
const candidateOwnedAuthStoreWrite = `export async function writeQaAuthProfiles(params: {
  agentDir: string;
  profiles: Record<string, QaAuthProfileCredential>;
  replace?: boolean;
}): Promise<void> {
  const releaseCompat = await import("../../rtt-release-qa-config-compat.mjs");
  const packageSpec = process.env.OPENCLAW_QA_RELEASE_PACKAGE_SPEC;
  const runtimePath = process.env.OPENCLAW_QA_RELEASE_AUTH_RUNTIME_PATH;
  const releaseAuthRuntimePath = releaseCompat.resolveReleaseAuthRuntimePath(
    packageSpec,
    runtimePath,
  );
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  if (releaseAuthRuntimePath) {
    process.env.OPENCLAW_STATE_DIR = path.resolve(params.agentDir, "../../..");
  }
  try {
    // Candidate modules cache state paths during evaluation, so the isolated QA
    // state root must be active before importing the candidate serializer.
    const releaseAuthRuntime = releaseAuthRuntimePath
      ? await releaseCompat.resolveReleaseAuthRuntime(packageSpec, runtimePath)
      : undefined;
    const loadStore =
      releaseAuthRuntime?.loadAuthProfileStoreWithoutExternalProfiles ??
      loadAuthProfileStoreWithoutExternalProfiles;
    const saveStore = releaseAuthRuntime?.saveAuthProfileStore ?? saveAuthProfileStore;
    const existing = loadStore(params.agentDir, {
      inheritedAuthDir: params.agentDir,
    });
    const nextStore: AuthProfileStore = params.replace
      ? { version: 1, profiles: params.profiles as AuthProfileStore["profiles"] }
      : {
          ...existing,
          version: 1,
          profiles: { ...existing.profiles, ...params.profiles } as AuthProfileStore["profiles"],
        };
    saveStore(nextStore, params.agentDir, {
      filterExternalAuthProfiles: false,
      syncExternalCli: false,
    });
  } finally {
    if (releaseAuthRuntimePath) {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  }
}`;

function usage() {
  return "Usage: node scripts/patch-openclaw-release-qa-harness.mjs <openclaw-repo-root>";
}

function replaceExactlyOnce(contents, anchor, replacement, pathname, label) {
  const anchorCount = contents.split(anchor).length - 1;
  const replacementCount = contents.split(replacement).length - 1;
  if (replacementCount === 1 && anchorCount === 0) {
    return { contents, patched: false };
  }
  if (replacementCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported release QA ${label} contract in ${pathname}`);
  }
  return {
    contents: contents.replace(anchor, replacement),
    patched: true,
  };
}

async function preparePatchAsset(sourcePath, targetPath) {
  const source = await fs.readFile(sourcePath, "utf8");
  let existing;
  try {
    existing = await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (existing !== undefined && existing !== source) {
    throw new Error(`Unsupported existing release QA patch asset in ${targetPath}`);
  }
  return {
    contents: source,
    path: targetPath,
    staged: existing === undefined,
  };
}

async function main() {
  const [repoRoot, ...extraArgs] = process.argv.slice(2);
  if (!repoRoot || extraArgs.length > 0) {
    throw new Error(usage());
  }

  const gatewayChildPath = path.resolve(repoRoot, "extensions/qa-lab/src/gateway-child.ts");
  const authStorePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/providers/shared/auth-store.ts",
  );
  const compatModulePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.mjs",
  );
  const compatDeclarationPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.d.mts",
  );
  const [originalGatewayChild, originalAuthStore] = await Promise.all([
    fs.readFile(gatewayChildPath, "utf8"),
    fs.readFile(authStorePath, "utf8"),
  ]);
  const gatewayPatch = replaceExactlyOnce(
    originalGatewayChild,
    gatewayConfigWriteAnchor,
    adaptedGatewayConfigWrite,
    gatewayChildPath,
    "gateway config",
  );
  const authStorePatch = replaceExactlyOnce(
    originalAuthStore,
    authStoreWriteAnchor,
    candidateOwnedAuthStoreWrite,
    authStorePath,
    "auth store",
  );
  const [compatModuleAsset, compatDeclarationAsset] = await Promise.all([
    preparePatchAsset(
      path.join(PATCH_ASSET_ROOT, "release-qa-config-compat.mjs"),
      compatModulePath,
    ),
    preparePatchAsset(
      path.join(PATCH_ASSET_ROOT, "release-qa-config-compat.d.mts"),
      compatDeclarationPath,
    ),
  ]);

  const writes = [];
  if (gatewayPatch.patched) {
    writes.push(fs.writeFile(gatewayChildPath, gatewayPatch.contents));
  }
  if (authStorePatch.patched) {
    writes.push(fs.writeFile(authStorePath, authStorePatch.contents));
  }
  if (compatModuleAsset.staged) {
    writes.push(fs.writeFile(compatModuleAsset.path, compatModuleAsset.contents));
  }
  if (compatDeclarationAsset.staged) {
    writes.push(fs.writeFile(compatDeclarationAsset.path, compatDeclarationAsset.contents));
  }
  await Promise.all(writes);

  const patchCount =
    Number(gatewayPatch.patched) +
    Number(authStorePatch.patched) +
    Number(compatModuleAsset.staged || compatDeclarationAsset.staged);
  process.stdout.write(
    patchCount > 0
      ? `patched ${patchCount} release QA compatibility contracts\n`
      : "release QA compatibility contracts already patched\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
