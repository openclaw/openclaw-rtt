import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_ASSET_ROOT = path.dirname(fileURLToPath(import.meta.url));

const callSites = [
  {
    label: "npm-telegram-package-install",
    broken:
      'run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\',
    fixed: 'run_logged_print "npm-telegram-package-install" docker_e2e_docker_run_cmd run --rm \\',
  },
  {
    label: "npm-telegram-live-suite",
    broken:
      'run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\',
    fixed: 'run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness \\',
  },
];

const harnessMountAnchor = `  -v "$OUTPUT_DIR_HOST:$OUTPUT_DIR_CONTAINER" \\`;
const harnessMounts = `${harnessMountAnchor}
  -v "$ROOT_DIR/taxonomy.yaml:/app/taxonomy.yaml:ro" \\
  -v "$ROOT_DIR/package.json:/openclaw-harness/package.json:ro" \\
  -v "$ROOT_DIR/dist:/openclaw-harness/dist:ro" \\
  -v "$ROOT_DIR/node_modules:/openclaw-harness/node_modules:ro" \\
  -v "$ROOT_DIR/packages:/openclaw-harness/packages:ro" \\
  -v "$ROOT_DIR/extensions:/openclaw-harness/extensions:ro" \\`;

const forwardedEnvAnchor = `  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH \\`;
const forwardedDowngradeEnv = `  OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS \\
${forwardedEnvAnchor}`;

const legacyRuntimeStart = `mkdir -p /app/node_modules
openclaw_package_dir="/npm-global/lib/node_modules/openclaw"`;
const trustedRuntimeStart = `mkdir -p /app/node_modules
# QA source and dependencies belong to the trusted current harness. The installed
# package remains the SUT through its absolute global openclaw command.`;
const runtimeEnd = `if [ "\${OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH:-0}" != "1" ]; then`;
const trustedRuntime = `${trustedRuntimeStart}
rm -rf /app/node_modules/openclaw /app/dist
ln -sfnT /openclaw-harness/dist /app/dist
cp /openclaw-harness/package.json /app/package.json
node scripts/e2e/lib/npm-telegram-live/prepare-package.mjs /app/package.json
for dependency_dir in /openclaw-harness/node_modules/*; do
  [ -e "$dependency_dir" ] || continue
  dependency_name="$(basename "$dependency_dir")"
  case "$dependency_name" in
    .bin | openclaw)
      continue
      ;;
    @*)
      [ -d "$dependency_dir" ] || continue
      mkdir -p "/app/node_modules/$dependency_name"
      for scoped_dependency_dir in "$dependency_dir"/*; do
        [ -e "$scoped_dependency_dir" ] || continue
        scoped_dependency_name="$(basename "$scoped_dependency_dir")"
        rm -rf "/app/node_modules/$dependency_name/$scoped_dependency_name"
        ln -sfnT "$scoped_dependency_dir" "/app/node_modules/$dependency_name/$scoped_dependency_name"
      done
      ;;
    *)
      rm -rf "/app/node_modules/$dependency_name"
      ln -sfnT "$dependency_dir" "/app/node_modules/$dependency_name"
      ;;
  esac
done
for package_json in \\
  /openclaw-harness/packages/*/package.json \\
  /openclaw-harness/extensions/*/package.json; do
  [ -f "$package_json" ] || continue
  package_name="$(node -p 'require(process.argv[1]).name' "$package_json")"
  package_dir="$(dirname "$package_json")"
  case "$package_name" in
    @*/*)
      package_scope="\${package_name%%/*}"
      package_basename="\${package_name#*/}"
      mkdir -p "/app/node_modules/$package_scope"
      rm -rf "/app/node_modules/$package_scope/$package_basename"
      ln -sfnT "$package_dir" "/app/node_modules/$package_scope/$package_basename"
      ;;
    *)
      rm -rf "/app/node_modules/$package_name"
      ln -sfnT "$package_dir" "/app/node_modules/$package_name"
      ;;
  esac
done
ln -sfnT /app /app/node_modules/openclaw

`;

const privateQaExports = `  const privatePluginSdkSubpaths = JSON.parse(
    fs.readFileSync(
      new URL("../../../lib/plugin-sdk-private-local-only-subpaths.json", import.meta.url),
      "utf8",
    ),
  );
  if (!Array.isArray(privatePluginSdkSubpaths)) {
    throw new Error("private plugin SDK subpaths must be an array");
  }
  for (const subpath of privatePluginSdkSubpaths) {
    if (typeof subpath !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(subpath)) {
      throw new Error(\`invalid private plugin SDK subpath: \${String(subpath)}\`);
    }
    pkg.exports[\`./plugin-sdk/\${subpath}\`] ??= {
      types: \`./dist/plugin-sdk/\${subpath}.d.ts\`,
      default: \`./dist/plugin-sdk/\${subpath}.js\`,
    };
  }
`;
const prepareWriteAnchor =
  '  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\\n`);';
const legacyRttCheck = 'const DEFAULT_RTT_CHECK_ID = "channel-canary";';
const telegramRttCheck =
  'const DEFAULT_RTT_CHECK_ID = "telegram-reply-chain-exact-marker";';
const gatewayConfigWriteAnchor = `      await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
        encoding: "utf8",
        mode: 0o600,
      });`;
const adaptedGatewayConfigWrite = `      const releaseCompatibleConfig = (
        await import("./rtt-telegram-release-config-compat.mjs")
      ).adaptTelegramReleaseGatewayConfig(cfg, process.env.OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC);
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
  const releaseCompat = await import("../../rtt-telegram-release-config-compat.mjs");
  const releaseAuthRuntimePath = releaseCompat.resolveTelegramReleaseAuthRuntimePath(
    process.env.OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC,
  );
  const releaseAuthRuntime = releaseAuthRuntimePath
    ? await releaseCompat.resolveTelegramReleaseAuthRuntime(
        process.env.OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC,
      )
    : undefined;
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  if (releaseAuthRuntimePath) {
    process.env.OPENCLAW_STATE_DIR = path.resolve(params.agentDir, "../../..");
  }
  try {
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
  return "Usage: node scripts/patch-openclaw-telegram-harness.mjs <openclaw-repo-root>";
}

function replaceRuntime(contents, scriptPath) {
  const legacyStartIndex = contents.indexOf(legacyRuntimeStart);
  const trustedStartIndex = contents.indexOf(trustedRuntimeStart);
  if (legacyStartIndex >= 0 && trustedStartIndex >= 0) {
    throw new Error(`Unsupported Telegram harness package contract in ${scriptPath}`);
  }
  if (trustedStartIndex >= 0) {
    if (contents.indexOf(runtimeEnd, trustedStartIndex) < 0) {
      throw new Error(`Unsupported Telegram harness package contract in ${scriptPath}`);
    }
    return { contents, patched: false };
  }
  if (legacyStartIndex < 0) {
    throw new Error(`Unsupported Telegram harness package contract in ${scriptPath}`);
  }
  const endIndex = contents.indexOf(runtimeEnd, legacyStartIndex);
  if (endIndex < 0) {
    throw new Error(`Unsupported Telegram harness package contract in ${scriptPath}`);
  }
  return {
    contents: `${contents.slice(0, legacyStartIndex)}${trustedRuntime}${contents.slice(endIndex)}`,
    patched: true,
  };
}

function patchHarnessMounts(contents, scriptPath) {
  const anchorCount = contents.split(harnessMountAnchor).length - 1;
  const patchedCount = contents.split(harnessMounts).length - 1;
  if (patchedCount === 1 && anchorCount === 1) {
    return { contents, patched: false };
  }
  if (patchedCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram harness mount contract in ${scriptPath}`);
  }
  return {
    contents: contents.replace(harnessMountAnchor, harnessMounts),
    patched: true,
  };
}

function patchForwardedDowngradeEnv(contents, scriptPath) {
  const patchedCount = contents.split(forwardedDowngradeEnv).length - 1;
  const anchorCount = contents.split(forwardedEnvAnchor).length - 1;
  if (patchedCount === 1 && anchorCount === 1) {
    return { contents, patched: false };
  }
  if (patchedCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram harness env contract in ${scriptPath}`);
  }
  return {
    contents: contents.replace(forwardedEnvAnchor, forwardedDowngradeEnv),
    patched: true,
  };
}

function patchPrivateQaExport(contents, preparePackagePath) {
  const exportCount = contents.split(privateQaExports).length - 1;
  const anchorCount = contents.split(prepareWriteAnchor).length - 1;
  if (exportCount === 1 && anchorCount === 1) {
    return { contents, patched: false };
  }
  if (exportCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram harness package manifest in ${preparePackagePath}`);
  }
  return {
    contents: contents.replace(prepareWriteAnchor, `${privateQaExports}${prepareWriteAnchor}`),
    patched: true,
  };
}

function patchRttCheck(contents, runnerPath) {
  const legacyCount = contents.split(legacyRttCheck).length - 1;
  const telegramCount = contents.split(telegramRttCheck).length - 1;
  if (telegramCount === 1 && legacyCount === 0) {
    return { contents, patched: false };
  }
  if (legacyCount !== 1 || telegramCount !== 0) {
    throw new Error(`Unsupported Telegram RTT check contract in ${runnerPath}`);
  }
  return {
    contents: contents.replace(legacyRttCheck, telegramRttCheck),
    patched: true,
  };
}

function patchGatewayConfigWrite(contents, gatewayChildPath) {
  const anchorCount = contents.split(gatewayConfigWriteAnchor).length - 1;
  const patchedCount = contents.split(adaptedGatewayConfigWrite).length - 1;
  if (patchedCount === 1 && anchorCount === 0) {
    return { contents, patched: false };
  }
  if (patchedCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram gateway config contract in ${gatewayChildPath}`);
  }
  return {
    contents: contents.replace(gatewayConfigWriteAnchor, adaptedGatewayConfigWrite),
    patched: true,
  };
}

function patchCandidateOwnedAuthStore(contents, authStorePath) {
  const anchorCount = contents.split(authStoreWriteAnchor).length - 1;
  const patchedCount = contents.split(candidateOwnedAuthStoreWrite).length - 1;
  if (patchedCount === 1 && anchorCount === 0) {
    return { contents, patched: false };
  }
  if (patchedCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram auth store contract in ${authStorePath}`);
  }
  return {
    contents: contents.replace(authStoreWriteAnchor, candidateOwnedAuthStoreWrite),
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
    throw new Error(`Unsupported existing Telegram RTT patch asset in ${targetPath}`);
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

  const scriptPath = path.resolve(repoRoot, "scripts/e2e/npm-telegram-live-docker.sh");
  const preparePackagePath = path.resolve(
    repoRoot,
    "scripts/e2e/lib/npm-telegram-live/prepare-package.mjs",
  );
  const runnerPath = path.resolve(repoRoot, "scripts/e2e/npm-telegram-live-runner.ts");
  const gatewayChildPath = path.resolve(repoRoot, "extensions/qa-lab/src/gateway-child.ts");
  const authStorePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/providers/shared/auth-store.ts",
  );
  const compatModulePath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.mjs",
  );
  const compatDeclarationPath = path.resolve(
    repoRoot,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.d.mts",
  );
  const [
    originalScript,
    originalPreparePackage,
    originalRunner,
    originalGatewayChild,
    originalAuthStore,
  ] = await Promise.all([
    fs.readFile(scriptPath, "utf8"),
    fs.readFile(preparePackagePath, "utf8"),
    fs.readFile(runnerPath, "utf8"),
    fs.readFile(gatewayChildPath, "utf8"),
    fs.readFile(authStorePath, "utf8"),
  ]);

  const lines = originalScript.split("\n");
  const states = callSites.map((callSite) => {
    const matches = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) => line.includes(`"${callSite.label}"`));
    if (matches.length !== 1) {
      return { kind: "unknown" };
    }
    const [match] = matches;
    if (match.line === callSite.broken) {
      return { index: match.index, kind: "broken" };
    }
    if (match.line === callSite.fixed) {
      return { index: match.index, kind: "fixed" };
    }
    return { kind: "unknown" };
  });
  const isBrokenLoggingContract = states.every((state) => state.kind === "broken");
  const isFixedLoggingContract = states.every((state) => state.kind === "fixed");
  if (!isBrokenLoggingContract && !isFixedLoggingContract) {
    throw new Error(`Unsupported Telegram harness logging contract in ${scriptPath}`);
  }
  if (isBrokenLoggingContract) {
    for (let index = 0; index < callSites.length; index += 1) {
      lines[states[index].index] = callSites[index].fixed;
    }
  }

  const mounts = patchHarnessMounts(lines.join("\n"), scriptPath);
  const forwardedEnv = patchForwardedDowngradeEnv(mounts.contents, scriptPath);
  const runtime = replaceRuntime(forwardedEnv.contents, scriptPath);
  const qaExportPatch = patchPrivateQaExport(originalPreparePackage, preparePackagePath);
  const rttCheckPatch = patchRttCheck(originalRunner, runnerPath);
  const gatewayConfigPatch = patchGatewayConfigWrite(originalGatewayChild, gatewayChildPath);
  const authStorePatch = patchCandidateOwnedAuthStore(originalAuthStore, authStorePath);
  const [compatModuleAsset, compatDeclarationAsset] = await Promise.all([
    preparePatchAsset(
      path.join(PATCH_ASSET_ROOT, "telegram-release-config-compat.mjs"),
      compatModulePath,
    ),
    preparePatchAsset(
      path.join(PATCH_ASSET_ROOT, "telegram-release-config-compat.d.mts"),
      compatDeclarationPath,
    ),
  ]);
  const patchedScript = runtime.contents;

  const writes = [];
  if (patchedScript !== originalScript) {
    writes.push(fs.writeFile(scriptPath, patchedScript));
  }
  if (qaExportPatch.contents !== originalPreparePackage) {
    writes.push(fs.writeFile(preparePackagePath, qaExportPatch.contents));
  }
  if (rttCheckPatch.contents !== originalRunner) {
    writes.push(fs.writeFile(runnerPath, rttCheckPatch.contents));
  }
  if (gatewayConfigPatch.contents !== originalGatewayChild) {
    writes.push(fs.writeFile(gatewayChildPath, gatewayConfigPatch.contents));
  }
  if (authStorePatch.contents !== originalAuthStore) {
    writes.push(fs.writeFile(authStorePath, authStorePatch.contents));
  }
  if (compatModuleAsset.staged) {
    writes.push(fs.writeFile(compatModuleAsset.path, compatModuleAsset.contents));
  }
  if (compatDeclarationAsset.staged) {
    writes.push(fs.writeFile(compatDeclarationAsset.path, compatDeclarationAsset.contents));
  }
  await Promise.all(writes);

  const packagePatchCount =
    Number(mounts.patched) +
    Number(forwardedEnv.patched) +
    Number(runtime.patched) +
    Number(qaExportPatch.patched) +
    Number(rttCheckPatch.patched) +
    Number(
      gatewayConfigPatch.patched ||
        compatModuleAsset.staged ||
        compatDeclarationAsset.staged,
    ) +
    Number(authStorePatch.patched);
  process.stdout.write(
    `${isBrokenLoggingContract ? `patched ${callSites.length}` : "preserved"} Telegram harness stdin consumers; ${
      packagePatchCount > 0
        ? `patched ${packagePatchCount} package harness contracts`
        : "package harness contracts already patched"
    }\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
