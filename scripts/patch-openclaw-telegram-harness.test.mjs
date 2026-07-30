import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-telegram-harness.mjs");

const legacyHarness = `#!/usr/bin/env bash
run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\
run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\
  -v "$ROOT_DIR/.artifacts:/app/.artifacts" \\
  -v "$OUTPUT_DIR_HOST:$OUTPUT_DIR_CONTAINER" \\
  -v "$ROOT_DIR/extensions/qa-lab:/app/extensions/qa-lab:ro" \\
for key in \\
  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH \\
  OPENCLAW_NPM_TELEGRAM_ALLOW_FAILURES; do
  forward_env_if_set "$key"
done
mkdir -p /app/node_modules
openclaw_package_dir="/npm-global/lib/node_modules/openclaw"
rm -rf /app/node_modules/openclaw
ln -sfnT "$openclaw_package_dir" /app/node_modules/openclaw
if [ "\${OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH:-0}" != "1" ]; then
  echo hotpath
fi
`;

const legacyPreparePackage = `import fs from "node:fs";

for (const packageJsonPath of process.argv.slice(2)) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  pkg.exports = pkg.exports && typeof pkg.exports === "object" ? pkg.exports : {};
  if (!pkg.exports["./plugin-sdk/gateway-runtime"]) {
    pkg.exports["./plugin-sdk/gateway-runtime"] = {
      types: "./dist/plugin-sdk/gateway-runtime.d.ts",
      default: "./dist/plugin-sdk/gateway-runtime.js",
    };
  }
  fs.writeFileSync(packageJsonPath, \`\${JSON.stringify(pkg, null, 2)}\\n\`);
}
`;
const legacyRunner = `const DEFAULT_RTT_CHECK_ID = "channel-canary";
`;
const legacyGatewayChild = `async function startGateway(configPath, cfg) {
      await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
        encoding: "utf8",
        mode: 0o600,
      });
}
`;
const privatePluginSdkSubpaths = ["qa-runtime", "sqlite-runtime-testing"];

async function makeFixture({
  harness = legacyHarness,
  preparePackage = legacyPreparePackage,
  runner = legacyRunner,
  gatewayChild = legacyGatewayChild,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-harness-test-"));
  const scriptPath = path.join(root, "scripts/e2e/npm-telegram-live-docker.sh");
  const preparePackagePath = path.join(
    root,
    "scripts/e2e/lib/npm-telegram-live/prepare-package.mjs",
  );
  const runnerPath = path.join(root, "scripts/e2e/npm-telegram-live-runner.ts");
  const gatewayChildPath = path.join(root, "extensions/qa-lab/src/gateway-child.ts");
  const privateSubpathsPath = path.join(
    root,
    "scripts/lib/plugin-sdk-private-local-only-subpaths.json",
  );
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.mkdir(path.dirname(preparePackagePath), { recursive: true });
  await fs.mkdir(path.dirname(privateSubpathsPath), { recursive: true });
  await fs.mkdir(path.dirname(gatewayChildPath), { recursive: true });
  await Promise.all([
    fs.writeFile(scriptPath, harness),
    fs.writeFile(preparePackagePath, preparePackage),
    fs.writeFile(runnerPath, runner),
    fs.writeFile(gatewayChildPath, gatewayChild),
    fs.writeFile(privateSubpathsPath, `${JSON.stringify(privatePluginSdkSubpaths)}\n`),
  ]);
  return { gatewayChildPath, preparePackagePath, root, runnerPath, scriptPath };
}

test("separates the trusted QA harness from the installed package SUT", async (t) => {
  const { gatewayChildPath, preparePackagePath, root, runnerPath, scriptPath } =
    await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched 2 Telegram harness stdin consumers/u);
  assert.match(first.stdout, /patched 6 package harness contracts/u);

  const patched = await fs.readFile(scriptPath, "utf8");
  assert.match(
    patched,
    /run_logged_print "npm-telegram-package-install" docker_e2e_docker_run_cmd run --rm/u,
  );
  assert.match(
    patched,
    /run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness/u,
  );
  assert.match(
    patched,
    /-v "\$ROOT_DIR\/dist:\/openclaw-harness\/dist:ro"/u,
  );
  assert.match(
    patched,
    /-v "\$ROOT_DIR\/node_modules:\/openclaw-harness\/node_modules:ro"/u,
  );
  assert.match(patched, /-v "\$ROOT_DIR\/taxonomy\.yaml:\/app\/taxonomy\.yaml:ro"/u);
  assert.match(patched, /-v "\$ROOT_DIR\/packages:\/openclaw-harness\/packages:ro"/u);
  assert.match(patched, /-v "\$ROOT_DIR\/extensions:\/openclaw-harness\/extensions:ro"/u);
  assert.match(
    patched,
    /OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS \\\n  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH/u,
  );
  assert.match(patched, /cp \/openclaw-harness\/package\.json \/app\/package\.json/u);
  assert.match(patched, /ln -sfnT \/openclaw-harness\/dist \/app\/dist/u);
  assert.match(patched, /for dependency_dir in \/openclaw-harness\/node_modules\/\*; do/u);
  assert.match(
    patched,
    /\/openclaw-harness\/packages\/\*\/package\.json[\s\S]*\/openclaw-harness\/extensions\/\*\/package\.json/u,
  );
  assert.match(
    patched,
    /ln -sfnT "\$package_dir" "\/app\/node_modules\/\$package_scope\/\$package_basename"/u,
  );
  assert.match(patched, /ln -sfnT \/app \/app\/node_modules\/openclaw/u);
  assert.doesNotMatch(patched, /openclaw_package_dir=/u);
  assert.doesNotMatch(patched, /link_installed_package_dependency/u);

  const patchedPreparePackage = await fs.readFile(preparePackagePath, "utf8");
  assert.match(
    patchedPreparePackage,
    /plugin-sdk-private-local-only-subpaths\.json/u,
  );
  const packagePath = path.join(root, "package.json");
  await fs.writeFile(
    packagePath,
    `${JSON.stringify({ exports: { "./plugin-sdk/core": "./dist/plugin-sdk/core.js" } })}\n`,
  );
  await execFileAsync(process.execPath, [preparePackagePath, packagePath]);
  const patchedPackage = JSON.parse(await fs.readFile(packagePath, "utf8"));
  assert.deepEqual(patchedPackage.exports["./plugin-sdk/qa-runtime"], {
    types: "./dist/plugin-sdk/qa-runtime.d.ts",
    default: "./dist/plugin-sdk/qa-runtime.js",
  });
  assert.deepEqual(patchedPackage.exports["./plugin-sdk/sqlite-runtime-testing"], {
    types: "./dist/plugin-sdk/sqlite-runtime-testing.d.ts",
    default: "./dist/plugin-sdk/sqlite-runtime-testing.js",
  });
  const patchedRunner = await fs.readFile(runnerPath, "utf8");
  assert.match(
    patchedRunner,
    /const DEFAULT_RTT_CHECK_ID = "telegram-reply-chain-exact-marker";/u,
  );
  const patchedGatewayChild = await fs.readFile(gatewayChildPath, "utf8");
  assert.match(
    patchedGatewayChild,
    /await import\("\.\/rtt-telegram-release-config-compat\.mjs"\)/u,
  );
  assert.match(
    patchedGatewayChild,
    /JSON\.stringify\(releaseCompatibleConfig, null, 2\)/u,
  );
  assert.equal(
    await fs.readFile(
      path.join(root, "extensions/qa-lab/src/rtt-telegram-release-config-compat.mjs"),
      "utf8",
    ),
    await fs.readFile(
      path.join(REPO_ROOT, "scripts/telegram-release-config-compat.mjs"),
      "utf8",
    ),
  );
  assert.equal(
    await fs.readFile(
      path.join(root, "extensions/qa-lab/src/rtt-telegram-release-config-compat.d.mts"),
      "utf8",
    ),
    await fs.readFile(
      path.join(REPO_ROOT, "scripts/telegram-release-config-compat.d.mts"),
      "utf8",
    ),
  );

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /preserved Telegram harness stdin consumers/u);
  assert.match(second.stdout, /package harness contracts already patched/u);
  assert.equal(await fs.readFile(scriptPath, "utf8"), patched);
  assert.equal(await fs.readFile(preparePackagePath, "utf8"), patchedPreparePackage);
  assert.equal(await fs.readFile(runnerPath, "utf8"), patchedRunner);
  assert.equal(await fs.readFile(gatewayChildPath, "utf8"), patchedGatewayChild);
});

test("fails closed for an unknown upstream Telegram harness contract", async (t) => {
  const { root } = await makeFixture({ harness: "#!/usr/bin/env bash\necho unknown\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Telegram harness logging contract/u,
  );
});

test("validates patch assets before mutating upstream files", async (t) => {
  const { gatewayChildPath, preparePackagePath, root, runnerPath, scriptPath } =
    await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const compatModulePath = path.join(
    root,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.mjs",
  );
  const compatDeclarationPath = path.join(
    root,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.d.mts",
  );
  await fs.writeFile(compatModulePath, "export const incompatible = true;\n");
  const originals = await Promise.all(
    [scriptPath, preparePackagePath, runnerPath, gatewayChildPath, compatModulePath].map((file) =>
      fs.readFile(file, "utf8"),
    ),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported existing Telegram RTT patch asset/u,
  );

  const after = await Promise.all(
    [scriptPath, preparePackagePath, runnerPath, gatewayChildPath, compatModulePath].map((file) =>
      fs.readFile(file, "utf8"),
    ),
  );
  assert.deepEqual(after, originals);
  await assert.rejects(fs.access(compatDeclarationPath), { code: "ENOENT" });
});

test("fails closed for mixed or duplicate Telegram logging contracts", async (t) => {
  const fixtures = [
    legacyHarness.replace(
      'run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\',
      'run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness \\',
    ),
    legacyHarness.replace(
      'run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\',
      `run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\
run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\`,
    ),
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const harness of fixtures) {
    const { root } = await makeFixture({ harness });
    roots.push(root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
      /Unsupported Telegram harness logging contract/u,
    );
  }
});

test("fails closed for unknown package mount, runtime, or manifest contracts", async (t) => {
  const fixtures = [
    { harness: legacyHarness.replace("-v \"$OUTPUT_DIR_HOST:$OUTPUT_DIR_CONTAINER\"", "-v custom") },
    {
      harness: legacyHarness.replace(
        "  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH \\",
        "  OPENCLAW_NPM_TELEGRAM_CUSTOM_ENV \\",
      ),
    },
    { harness: legacyHarness.replace('openclaw_package_dir="/npm-global/lib/node_modules/openclaw"', "echo custom") },
    { preparePackage: legacyPreparePackage.replace("fs.writeFileSync", "customWrite") },
    { runner: 'const DEFAULT_RTT_CHECK_ID = "custom";\n' },
    { gatewayChild: legacyGatewayChild.replace("fs.writeFile", "customWrite") },
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const fixture of fixtures) {
    const { root } = await makeFixture(fixture);
    roots.push(root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
      /Unsupported Telegram (harness (mount|env contract|package contract|package manifest)|RTT check contract|gateway config contract)/u,
    );
  }
});
