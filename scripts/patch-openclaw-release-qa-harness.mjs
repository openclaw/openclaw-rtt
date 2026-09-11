import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PATCH_ASSET_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Runs inside a one-shot child process whose OPENCLAW_STATE_DIR is the QA
// state root of exactly one seeding agent. Candidate release auth runtimes
// read state paths from the process environment (module-evaluation time or
// per call), so serialization must not share a process-global env window
// with concurrently seeding agents.
export const isolatedAuthStoreWorker = `
import { pathToFileURL } from "node:url";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const releaseAuthRuntime = await import(
  pathToFileURL(input.releaseAuthRuntimePath).href
);
const loadStore = releaseAuthRuntime.loadAuthProfileStoreWithoutExternalProfiles;
const saveStore = releaseAuthRuntime.saveAuthProfileStore;
if (typeof loadStore !== "function" || typeof saveStore !== "function") {
  throw new Error(
    "Candidate release auth runtime must export loadAuthProfileStoreWithoutExternalProfiles and saveAuthProfileStore."
  );
}

const existing = loadStore(input.agentDir, { inheritedAuthDir: input.agentDir });
const nextStore = {
  ...existing,
  version: 1,
  profiles: input.replace
    ? { ...input.profiles }
    : { ...(existing.profiles ?? {}), ...input.profiles },
};
if (input.replace) {
  delete nextStore.order;
  delete nextStore.lastGood;
  delete nextStore.usageStats;
}
saveStore(nextStore, input.agentDir, {
  filterExternalAuthProfiles: false,
  syncExternalCli: false,
});
process.stdout.write(JSON.stringify({ ok: true }));
`;

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
  // Candidate release auth runtimes read their state root from the process
  // environment, so serialization runs in a one-shot child process whose env
  // is exactly this seeding agent's state dir. This process never mutates its
  // own env, so concurrently seeding agents can never observe or clobber each
  // other's state dir across an await boundary.
  const { spawn } = await import("node:child_process");
  const worker = ${JSON.stringify(isolatedAuthStoreWorker)};
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", worker], {
      env: { ...process.env, OPENCLAW_STATE_DIR: params.stateDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(\`Isolated release auth store save failed (\${signal ?? \`exit \${code}\`}): \${stderr.trim()}\`));
      }
    });
    child.stdin.end(JSON.stringify({
      agentDir,
      profiles: params.profiles,
      replace: Boolean(params.replace),
      releaseAuthRuntimePath,
    }));
  });
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
    original: existing,
    path: targetPath,
    staged: existing === undefined,
  };
}

// Committing the patch as a multi-file set is atomic-enough by construction:
// every write is staged to a sibling temp file first and only then renamed
// into place one at a time. If any step fails, files that were already
// renamed are restored from their recorded original contents (best effort),
// temp files are cleaned up, and the error names any path that still needs
// manual recovery.
export async function commitPatchWrites(writes) {
  const staged = [];
  try {
    for (const { contents, original, path: targetPath } of writes) {
      const tempPath = path.join(
        path.dirname(targetPath),
        `.tmp-${path.basename(targetPath)}`,
      );
      await fs.writeFile(tempPath, contents, "utf8");
      staged.push({ committed: false, original, targetPath, tempPath });
    }
    for (const entry of staged) {
      await fs.rename(entry.tempPath, entry.targetPath);
      entry.committed = true;
    }
  } catch (error) {
    const needsManualRestore = [];
    for (const entry of staged) {
      if (entry.committed) {
        try {
          if (entry.original === undefined) {
            await fs.unlink(entry.targetPath);
          } else {
            await fs.writeFile(entry.targetPath, entry.original, "utf8");
          }
        } catch {
          needsManualRestore.push(entry.targetPath);
        }
      } else {
        try {
          await fs.unlink(entry.tempPath);
        } catch {
          // Best-effort temp cleanup only.
        }
      }
    }
    const message =
      `release QA patch commit failed (${error instanceof Error ? error.message : String(error)}); ` +
      `previously moved files were rolled back.`;
    if (needsManualRestore.length) {
      throw new Error(
        `${message} Manual restore needed for: ${needsManualRestore.join(", ")} ` +
          `(restore the original content or run git checkout -- <path> in the openclaw-qa checkout).`,
      );
    }
    throw new Error(message);
  }
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

  // Each write records the original target contents (undefined for newly
  // created assets) so commitPatchWrites can roll back already-moved files if
  // a later rename in the set fails.
  const writes = [];
  if (gatewayPatch.patched) {
    writes.push({
      contents: gatewayPatch.contents,
      original: originalGatewaySetup,
      path: gatewaySetupPath,
    });
  }
  if (authStorePatch.patched) {
    writes.push({
      contents: authStorePatch.contents,
      original: originalAuthStore,
      path: authStorePath,
    });
  }
  if (replacePathsErrorPatch.patched || liveConfigPatch.patched) {
    writes.push({
      contents: liveConfigPatch.contents,
      original: originalLiveGatewayConfig,
      path: liveGatewayConfigPath,
    });
  }
  if (compatModuleAsset.staged) {
    writes.push({
      contents: compatModuleAsset.contents,
      original: compatModuleAsset.original,
      path: compatModuleAsset.path,
    });
  }
  if (compatDeclarationAsset.staged) {
    writes.push({
      contents: compatDeclarationAsset.contents,
      original: compatDeclarationAsset.original,
      path: compatDeclarationAsset.path,
    });
  }
  if (writes.length > 0) {
    await commitPatchWrites(writes);
  }

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

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
