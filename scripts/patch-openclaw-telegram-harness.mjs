import fs from "node:fs/promises";
import path from "node:path";

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

const qaExport = `  if (!pkg.exports["./plugin-sdk/qa-runtime"]) {
    pkg.exports["./plugin-sdk/qa-runtime"] = {
      types: "./dist/plugin-sdk/qa-runtime.d.ts",
      default: "./dist/plugin-sdk/qa-runtime.js",
    };
  }
`;
const prepareWriteAnchor =
  '  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\\n`);';
const legacyRttCheck = 'const DEFAULT_RTT_CHECK_ID = "channel-canary";';
const telegramRttCheck =
  'const DEFAULT_RTT_CHECK_ID = "telegram-reply-chain-exact-marker";';

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

function patchPrivateQaExport(contents, preparePackagePath) {
  const exportCount = contents.split(qaExport).length - 1;
  const anchorCount = contents.split(prepareWriteAnchor).length - 1;
  if (exportCount === 1 && anchorCount === 1) {
    return { contents, patched: false };
  }
  if (exportCount !== 0 || anchorCount !== 1) {
    throw new Error(`Unsupported Telegram harness package manifest in ${preparePackagePath}`);
  }
  return {
    contents: contents.replace(prepareWriteAnchor, `${qaExport}${prepareWriteAnchor}`),
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
  const [originalScript, originalPreparePackage, originalRunner] = await Promise.all([
    fs.readFile(scriptPath, "utf8"),
    fs.readFile(preparePackagePath, "utf8"),
    fs.readFile(runnerPath, "utf8"),
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
  const runtime = replaceRuntime(mounts.contents, scriptPath);
  const qaExportPatch = patchPrivateQaExport(originalPreparePackage, preparePackagePath);
  const rttCheckPatch = patchRttCheck(originalRunner, runnerPath);
  const patchedScript = runtime.contents;

  if (patchedScript !== originalScript) {
    await fs.writeFile(scriptPath, patchedScript);
  }
  if (qaExportPatch.contents !== originalPreparePackage) {
    await fs.writeFile(preparePackagePath, qaExportPatch.contents);
  }
  if (rttCheckPatch.contents !== originalRunner) {
    await fs.writeFile(runnerPath, rttCheckPatch.contents);
  }

  const packagePatchCount =
    Number(mounts.patched) +
    Number(runtime.patched) +
    Number(qaExportPatch.patched) +
    Number(rttCheckPatch.patched);
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
