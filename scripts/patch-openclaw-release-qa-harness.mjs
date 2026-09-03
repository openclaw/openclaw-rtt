import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_ASSET_ROOT = path.dirname(fileURLToPath(import.meta.url));

const gatewayConfigWriteAnchor = `        await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
          encoding: "utf8",
          mode: 0o600,
        });`;
const adaptedGatewayConfigWrite = `        const releaseCompatibleConfig = (
          await import("./rtt-release-qa-config-compat.mjs")
        ).adaptReleaseGatewayConfig(cfg, process.env.OPENCLAW_QA_RELEASE_PACKAGE_SPEC);
        await fs.writeFile(configPath, \`\${JSON.stringify(releaseCompatibleConfig, null, 2)}\\n\`, {
          encoding: "utf8",
          mode: 0o600,
        });`;
const authStoreWriteAnchor = `export async function writeQaAuthProfiles(params: {
  agentId: string;
  profiles: Record<string, QaAuthProfileCredential>;
  replace?: boolean;
  stateDir: string;
}): Promise<void> {
  const agentDir = resolveQaAgentAuthDir(params);
  // Surface pending legacy-source errors before the locked updater, whose
  // public failure contract is intentionally nullable.
  loadAuthProfileStoreWithoutExternalProfiles(agentDir, { inheritedAuthDir: agentDir });
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    stateDir: params.stateDir,
    saveOptions: {
      filterExternalAuthProfiles: false,
      syncExternalCli: false,
    },
    updater: (store) => {
      store.version = 1;
      store.profiles = params.replace
        ? { ...params.profiles }
        : { ...store.profiles, ...params.profiles };
      if (params.replace) {
        delete store.order;
        delete store.lastGood;
        delete store.usageStats;
      }
      return true;
    },
  });
  if (!updated) {
    throw new Error("Failed to stage the isolated QA auth profile store.");
  }
}`;
const candidateOwnedAuthStoreWrite = `export async function writeQaAuthProfiles(params: {
  agentId: string;
  profiles: Record<string, QaAuthProfileCredential>;
  replace?: boolean;
  stateDir: string;
}): Promise<void> {
  const agentDir = resolveQaAgentAuthDir(params);
  const releaseCompat = await import("../../rtt-release-qa-config-compat.mjs");
  const packageSpec = process.env.OPENCLAW_QA_RELEASE_PACKAGE_SPEC;
  const runtimePath = process.env.OPENCLAW_QA_RELEASE_AUTH_RUNTIME_PATH;
  const releaseAuthRuntimePath = releaseCompat.resolveReleaseAuthRuntimePath(
    packageSpec,
    runtimePath,
  );
  if (!releaseAuthRuntimePath) {
    loadAuthProfileStoreWithoutExternalProfiles(agentDir, { inheritedAuthDir: agentDir });
    const updated = await updateAuthProfileStoreWithLock({
      agentDir,
      stateDir: params.stateDir,
      saveOptions: {
        filterExternalAuthProfiles: false,
        syncExternalCli: false,
      },
      updater: (store) => {
        store.version = 1;
        store.profiles = params.replace
          ? { ...params.profiles }
          : { ...store.profiles, ...params.profiles };
        if (params.replace) {
          delete store.order;
          delete store.lastGood;
          delete store.usageStats;
        }
        return true;
      },
    });
    if (!updated) {
      throw new Error("Failed to stage the isolated QA auth profile store.");
    }
    return;
  }
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = params.stateDir;
  try {
    // Candidate modules cache state paths during evaluation, so the isolated QA
    // state root must be active before importing the candidate serializer.
    const releaseAuthRuntime = await releaseCompat.resolveReleaseAuthRuntime(packageSpec, runtimePath);
    const loadStore =
      releaseAuthRuntime?.loadAuthProfileStoreWithoutExternalProfiles ??
      loadAuthProfileStoreWithoutExternalProfiles;
    const saveStore = releaseAuthRuntime?.saveAuthProfileStore;
    if (!saveStore) {
      throw new Error("Candidate release auth runtime does not export saveAuthProfileStore.");
    }
    const existing = loadStore(agentDir, {
      inheritedAuthDir: agentDir,
    });
    const nextStore = {
      ...existing,
      version: 1,
      profiles: params.replace
        ? { ...params.profiles }
        : { ...existing.profiles, ...params.profiles },
    };
    if (params.replace) {
      delete nextStore.order;
      delete nextStore.lastGood;
      delete nextStore.usageStats;
    }
    saveStore(nextStore, agentDir, {
      filterExternalAuthProfiles: false,
      syncExternalCli: false,
    });
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  }
}`;
const unsupportedReplacePathsAnchor = `function isStaleConfigPatchError(error: unknown) {
  return formatErrorMessage(error).toLowerCase().includes("config changed since last load");
}

async function waitForLiveQaGatewayConfigApplied`;
const unsupportedReplacePathsCompat = `function isStaleConfigPatchError(error: unknown) {
  return formatErrorMessage(error).toLowerCase().includes("config changed since last load");
}

function isUnsupportedReplacePathsError(error: unknown) {
  const message = formatErrorMessage(error).toLowerCase();
  return message.includes("unexpected property") && message.includes("replacepaths");
}

async function waitForLiveQaGatewayConfigApplied`;
const liveConfigPatchAnchor = `      patchResult =
        ((await params.gateway.call(
          "config.patch",
          {
            raw: JSON.stringify(params.patch, null, 2),
            baseHash: snapshot.hash,
            ...(params.replacePaths?.length ? { replacePaths: params.replacePaths } : {}),
            restartDelayMs: 0,
          },
          { timeoutMs: 60_000 },
        )) as { noop?: boolean } | null | undefined) ?? {};`;
const releaseCompatibleLiveConfigPatch = `      const raw = JSON.stringify(params.patch, null, 2);
      const callConfigPatch = async (includeReplacePaths: boolean) =>
        ((await params.gateway.call(
          "config.patch",
          {
            raw,
            baseHash: snapshot.hash,
            ...(includeReplacePaths && params.replacePaths?.length
              ? { replacePaths: params.replacePaths }
              : {}),
            restartDelayMs: 0,
          },
          { timeoutMs: 60_000 },
        )) as { noop?: boolean } | null | undefined) ?? {};
      try {
        patchResult = await callConfigPatch(true);
      } catch (error) {
        if (!params.replacePaths?.length || !isUnsupportedReplacePathsError(error)) {
          throw error;
        }
        patchResult = await callConfigPatch(false);
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

  const gatewaySetupPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/gateway-child-setup.ts",
  );
  const authStorePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/providers/shared/auth-store.ts",
  );
  const liveGatewayConfigPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/live-transports/shared/live-gateway-config.runtime.ts",
  );
  const compatModulePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.mjs",
  );
  const compatDeclarationPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.d.mts",
  );
  const [originalGatewaySetup, originalAuthStore, originalLiveGatewayConfig] = await Promise.all([
    fs.readFile(gatewaySetupPath, "utf8"),
    fs.readFile(authStorePath, "utf8"),
    fs.readFile(liveGatewayConfigPath, "utf8"),
  ]);
  const gatewayPatch = replaceExactlyOnce(
    originalGatewaySetup,
    gatewayConfigWriteAnchor,
    adaptedGatewayConfigWrite,
    gatewaySetupPath,
    "gateway config",
  );
  const authStorePatch = replaceExactlyOnce(
    originalAuthStore,
    authStoreWriteAnchor,
    candidateOwnedAuthStoreWrite,
    authStorePath,
    "auth store",
  );
  const replacePathsErrorPatch = replaceExactlyOnce(
    originalLiveGatewayConfig,
    unsupportedReplacePathsAnchor,
    unsupportedReplacePathsCompat,
    liveGatewayConfigPath,
    "replacePaths error detection",
  );
  const liveConfigPatch = replaceExactlyOnce(
    replacePathsErrorPatch.contents,
    liveConfigPatchAnchor,
    releaseCompatibleLiveConfigPatch,
    liveGatewayConfigPath,
    "live config patch",
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
    writes.push(fs.writeFile(gatewaySetupPath, gatewayPatch.contents));
  }
  if (authStorePatch.patched) {
    writes.push(fs.writeFile(authStorePath, authStorePatch.contents));
  }
  if (replacePathsErrorPatch.patched || liveConfigPatch.patched) {
    writes.push(fs.writeFile(liveGatewayConfigPath, liveConfigPatch.contents));
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
    Number(replacePathsErrorPatch.patched || liveConfigPatch.patched) +
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
