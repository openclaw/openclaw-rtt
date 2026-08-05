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

const packageInstallHeartbeat =
  'run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\';
const liveSuiteHeartbeat =
  'run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\';
const liveHarness = `#!/usr/bin/env bash
${packageInstallHeartbeat}
${liveSuiteHeartbeat}
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

const livePreparePackage = `import fs from "node:fs";

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
const liveRunner = `const DEFAULT_RTT_CHECK_ID = "channel-canary";
`;
const legacyRuntimeStart = `mkdir -p /app/node_modules
openclaw_package_dir="/npm-global/lib/node_modules/openclaw"`;
const trustedRuntimeStart = `mkdir -p /app/node_modules
# QA source and dependencies belong to the trusted current harness. The installed
# package remains the SUT through its absolute global openclaw command.`;
const runtimeEnd = `if [ "\${OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH:-0}" != "1" ]; then`;
const liveGatewayChild = `async function startGateway(configPath, cfg) {
  let reuseStartupLaunchState = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!reuseStartupLaunchState) {
        await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
          encoding: "utf8",
          mode: 0o600,
        });
    }
    reuseStartupLaunchState = false;
    const startupRetry = await start();
    reuseStartupLaunchState = startupRetry?.reuseLaunchState ?? false;
  }
}
`;
const liveAuthStore = `export async function writeQaAuthProfiles(params: {
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
}
`;
const privatePluginSdkSubpaths = ["qa-runtime", "sqlite-runtime-testing"];

async function makeFixture({
  authStore = liveAuthStore,
  gatewayChild = liveGatewayChild,
  harness = liveHarness,
  preparePackage = livePreparePackage,
  runner = liveRunner,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-harness-test-"));
  const scriptPath = path.join(root, "scripts/e2e/npm-telegram-live-docker.sh");
  const preparePackagePath = path.join(
    root,
    "scripts/e2e/lib/npm-telegram-live/prepare-package.mjs",
  );
  const runnerPath = path.join(root, "scripts/e2e/npm-telegram-live-runner.ts");
  const gatewayChildPath = path.join(root, "extensions/qa-lab/src/gateway-child.ts");
  const authStorePath = path.join(
    root,
    "extensions/qa-lab/src/providers/shared/auth-store.ts",
  );
  const privateSubpathsPath = path.join(
    root,
    "scripts/lib/plugin-sdk-private-local-only-subpaths.json",
  );
  const compatModulePath = path.join(
    root,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.mjs",
  );
  const compatDeclarationPath = path.join(
    root,
    "extensions/qa-lab/src/rtt-telegram-release-config-compat.d.mts",
  );
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.mkdir(path.dirname(preparePackagePath), { recursive: true });
  await fs.mkdir(path.dirname(privateSubpathsPath), { recursive: true });
  await fs.mkdir(path.dirname(gatewayChildPath), { recursive: true });
  await fs.mkdir(path.dirname(authStorePath), { recursive: true });
  await Promise.all([
    fs.writeFile(scriptPath, harness),
    fs.writeFile(preparePackagePath, preparePackage),
    fs.writeFile(runnerPath, runner),
    fs.writeFile(gatewayChildPath, gatewayChild),
    fs.writeFile(authStorePath, authStore),
    fs.writeFile(privateSubpathsPath, `${JSON.stringify(privatePluginSdkSubpaths)}\n`),
  ]);
  return {
    authStorePath,
    compatDeclarationPath,
    compatModulePath,
    gatewayChildPath,
    preparePackagePath,
    root,
    runnerPath,
    scriptPath,
  };
}

function heartbeatLines(contents) {
  return contents
    .split("\n")
    .filter(
      (line) =>
        line.includes('"npm-telegram-package-install"') ||
        line.includes('"npm-telegram-live-suite"'),
    );
}

test("patches the live shared harness without release-only mutations", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  const originalHeartbeatLines = heartbeatLines(liveHarness);
  const originalGatewayChild = await fs.readFile(fixture.gatewayChildPath, "utf8");
  const originalAuthStore = await fs.readFile(fixture.authStorePath, "utf8");

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, fixture.root]);
  assert.match(first.stdout, /patched 4 shared Telegram harness contracts/u);

  const patchedHarness = await fs.readFile(fixture.scriptPath, "utf8");
  assert.deepEqual(heartbeatLines(patchedHarness), originalHeartbeatLines);
  assert.match(patchedHarness, /-v "\$ROOT_DIR\/taxonomy\.yaml:\/app\/taxonomy\.yaml:ro"/u);
  assert.match(patchedHarness, /-v "\$ROOT_DIR\/packages:\/openclaw-harness\/packages:ro"/u);
  assert.match(patchedHarness, /ln -sfnT \/app \/app\/node_modules\/openclaw/u);
  assert.doesNotMatch(patchedHarness, /OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS/u);

  const patchedPreparePackage = await fs.readFile(fixture.preparePackagePath, "utf8");
  assert.match(patchedPreparePackage, /plugin-sdk-private-local-only-subpaths\.json/u);
  const packagePath = path.join(fixture.root, "package.json");
  await fs.writeFile(
    packagePath,
    `${JSON.stringify({ exports: { "./plugin-sdk/core": "./dist/plugin-sdk/core.js" } })}\n`,
  );
  await execFileAsync(process.execPath, [fixture.preparePackagePath, packagePath]);
  const patchedPackage = JSON.parse(await fs.readFile(packagePath, "utf8"));
  assert.deepEqual(patchedPackage.exports["./plugin-sdk/qa-runtime"], {
    types: "./dist/plugin-sdk/qa-runtime.d.ts",
    default: "./dist/plugin-sdk/qa-runtime.js",
  });
  assert.deepEqual(patchedPackage.exports["./plugin-sdk/sqlite-runtime-testing"], {
    types: "./dist/plugin-sdk/sqlite-runtime-testing.d.ts",
    default: "./dist/plugin-sdk/sqlite-runtime-testing.js",
  });
  const patchedRunner = await fs.readFile(fixture.runnerPath, "utf8");
  assert.match(
    patchedRunner,
    /const DEFAULT_RTT_CHECK_ID = "telegram-reply-chain-exact-marker";/u,
  );
  assert.equal(await fs.readFile(fixture.gatewayChildPath, "utf8"), originalGatewayChild);
  assert.equal(await fs.readFile(fixture.authStorePath, "utf8"), originalAuthStore);
  await assert.rejects(fs.access(fixture.compatModulePath), { code: "ENOENT" });
  await assert.rejects(fs.access(fixture.compatDeclarationPath), { code: "ENOENT" });

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, fixture.root]);
  assert.match(second.stdout, /shared Telegram harness contracts already patched/u);
  assert.equal(await fs.readFile(fixture.scriptPath, "utf8"), patchedHarness);
  assert.equal(await fs.readFile(fixture.preparePackagePath, "utf8"), patchedPreparePackage);
  assert.equal(await fs.readFile(fixture.runnerPath, "utf8"), patchedRunner);
});

test("default mode ignores unsupported release-only contracts", async (t) => {
  const fixture = await makeFixture({
    authStore: "export const unsupportedAuthStore = true;\n",
    gatewayChild: "export const unsupportedGateway = true;\n",
  });
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  const originalGatewayChild = await fs.readFile(fixture.gatewayChildPath, "utf8");
  const originalAuthStore = await fs.readFile(fixture.authStorePath, "utf8");

  await execFileAsync(process.execPath, [PATCH_SCRIPT, fixture.root]);

  assert.equal(await fs.readFile(fixture.gatewayChildPath, "utf8"), originalGatewayChild);
  assert.equal(await fs.readFile(fixture.authStorePath, "utf8"), originalAuthStore);
});

test("release mode patches and stages only the known release compatibility contracts", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  const originalHeartbeatLines = heartbeatLines(liveHarness);
  const originalRetryLifecycle = liveGatewayChild
    .split("\n")
    .filter((line) => line.includes("reuseStartupLaunchState"));

  const first = await execFileAsync(process.execPath, [
    PATCH_SCRIPT,
    "--release-compat",
    fixture.root,
  ]);
  assert.match(first.stdout, /patched 4 shared Telegram harness contracts/u);
  assert.match(first.stdout, /patched 3 release compatibility contracts/u);

  const patchedHarness = await fs.readFile(fixture.scriptPath, "utf8");
  assert.deepEqual(heartbeatLines(patchedHarness), originalHeartbeatLines);
  assert.match(
    patchedHarness,
    /OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS \\\n  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH/u,
  );

  const patchedGatewayChild = await fs.readFile(fixture.gatewayChildPath, "utf8");
  assert.match(
    patchedGatewayChild,
    /await import\("\.\/rtt-telegram-release-config-compat\.mjs"\)/u,
  );
  assert.match(
    patchedGatewayChild,
    /JSON\.stringify\(releaseCompatibleConfig, null, 2\)/u,
  );
  assert.deepEqual(
    patchedGatewayChild
      .split("\n")
      .filter((line) => line.includes("reuseStartupLaunchState")),
    originalRetryLifecycle,
  );

  const patchedAuthStore = await fs.readFile(fixture.authStorePath, "utf8");
  assert.match(
    patchedAuthStore,
    /process\.env\.OPENCLAW_STATE_DIR = path\.resolve\(params\.agentDir, "\.\.\/\.\.\/\.\."\)/u,
  );
  assert.match(
    patchedAuthStore,
    /releaseAuthRuntime\?\.saveAuthProfileStore \?\? saveAuthProfileStore/u,
  );
  assert.match(patchedAuthStore, /delete process\.env\.OPENCLAW_STATE_DIR/u);
  const stateOverrideIndex = patchedAuthStore.indexOf(
    "process.env.OPENCLAW_STATE_DIR = path.resolve",
  );
  const stateRestoreIndex = patchedAuthStore.indexOf(
    "if (releaseAuthRuntimePath) {",
    stateOverrideIndex + 1,
  );
  assert.ok(stateOverrideIndex >= 0 && stateRestoreIndex > stateOverrideIndex);
  assert.doesNotMatch(
    patchedAuthStore.slice(stateOverrideIndex, stateRestoreIndex),
    /\bawait\b/u,
  );
  assert.equal(
    await fs.readFile(fixture.compatModulePath, "utf8"),
    await fs.readFile(path.join(REPO_ROOT, "scripts/telegram-release-config-compat.mjs"), "utf8"),
  );
  assert.equal(
    await fs.readFile(fixture.compatDeclarationPath, "utf8"),
    await fs.readFile(path.join(REPO_ROOT, "scripts/telegram-release-config-compat.d.mts"), "utf8"),
  );

  const patchedFiles = await Promise.all(
    [
      fixture.scriptPath,
      fixture.preparePackagePath,
      fixture.runnerPath,
      fixture.gatewayChildPath,
      fixture.authStorePath,
      fixture.compatModulePath,
      fixture.compatDeclarationPath,
    ].map((file) => fs.readFile(file, "utf8")),
  );
  const second = await execFileAsync(process.execPath, [
    PATCH_SCRIPT,
    "--release-compat",
    fixture.root,
  ]);
  assert.match(second.stdout, /shared Telegram harness contracts already patched/u);
  assert.match(second.stdout, /release compatibility contracts already patched/u);
  assert.deepEqual(
    await Promise.all(
      [
        fixture.scriptPath,
        fixture.preparePackagePath,
        fixture.runnerPath,
        fixture.gatewayChildPath,
        fixture.authStorePath,
        fixture.compatModulePath,
        fixture.compatDeclarationPath,
      ].map((file) => fs.readFile(file, "utf8")),
    ),
    patchedFiles,
  );
});

test("release mode validates patch assets before mutating upstream files", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  await fs.writeFile(fixture.compatModulePath, "export const incompatible = true;\n");
  const originalFiles = await Promise.all(
    [
      fixture.scriptPath,
      fixture.preparePackagePath,
      fixture.runnerPath,
      fixture.gatewayChildPath,
      fixture.authStorePath,
      fixture.compatModulePath,
    ].map((file) => fs.readFile(file, "utf8")),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, "--release-compat", fixture.root]),
    /Unsupported existing Telegram RTT patch asset/u,
  );

  assert.deepEqual(
    await Promise.all(
      [
        fixture.scriptPath,
        fixture.preparePackagePath,
        fixture.runnerPath,
        fixture.gatewayChildPath,
        fixture.authStorePath,
        fixture.compatModulePath,
      ].map((file) => fs.readFile(file, "utf8")),
    ),
    originalFiles,
  );
  await assert.rejects(fs.access(fixture.compatDeclarationPath), { code: "ENOENT" });
});

test("fails closed for unknown shared harness contracts", async (t) => {
  const fixtures = [
    { harness: liveHarness.replace("-v \"$OUTPUT_DIR_HOST:$OUTPUT_DIR_CONTAINER\"", "-v custom") },
    {
      harness: liveHarness.replace(
        'openclaw_package_dir="/npm-global/lib/node_modules/openclaw"',
        "echo custom",
      ),
    },
    { preparePackage: livePreparePackage.replace("fs.writeFileSync", "customWrite") },
    { runner: 'const DEFAULT_RTT_CHECK_ID = "custom";\n' },
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const fixtureOptions of fixtures) {
    const fixture = await makeFixture(fixtureOptions);
    roots.push(fixture.root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, fixture.root]),
      /Unsupported Telegram (harness (mount contract|package contract|package manifest)|RTT check contract)/u,
    );
  }
});

test("rejects incomplete, duplicate, mixed, or noncontiguous trusted runtime blocks", async (t) => {
  const sourceFixture = await makeFixture();
  const roots = [sourceFixture.root];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));
  await execFileAsync(process.execPath, [PATCH_SCRIPT, sourceFixture.root]);
  const patchedHarness = await fs.readFile(sourceFixture.scriptPath, "utf8");
  const variants = [
    patchedHarness.replace(
      "ln -sfnT /app /app/node_modules/openclaw",
      "echo incomplete trusted runtime",
    ),
    patchedHarness.replace(trustedRuntimeStart, `${trustedRuntimeStart}\n${trustedRuntimeStart}`),
    patchedHarness.replace(trustedRuntimeStart, `${legacyRuntimeStart}\n${trustedRuntimeStart}`),
    patchedHarness.replace(
      `ln -sfnT /app /app/node_modules/openclaw\n\n${runtimeEnd}`,
      `ln -sfnT /app /app/node_modules/openclaw\n\necho noncontiguous\n${runtimeEnd}`,
    ),
  ];

  for (const harness of variants) {
    assert.notEqual(harness, patchedHarness);
    const fixture = await makeFixture({ harness });
    roots.push(fixture.root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, fixture.root]),
      /Unsupported Telegram harness package contract/u,
    );
    assert.equal(await fs.readFile(fixture.scriptPath, "utf8"), harness);
  }
});

test("release mode fails closed for unknown release compatibility contracts", async (t) => {
  const fixtures = [
    {
      harness: liveHarness.replace(
        "  OPENCLAW_NPM_TELEGRAM_SKIP_HOTPATH \\",
        "  OPENCLAW_NPM_TELEGRAM_CUSTOM_ENV \\",
      ),
    },
    { gatewayChild: liveGatewayChild.replace("fs.writeFile", "customWrite") },
    { authStore: liveAuthStore.replace("saveAuthProfileStore", "customSave") },
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const fixtureOptions of fixtures) {
    const fixture = await makeFixture(fixtureOptions);
    roots.push(fixture.root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, "--release-compat", fixture.root]),
      /Unsupported Telegram (harness env contract|gateway config contract|auth store contract)/u,
    );
  }
});

test("rejects invalid mode and argument combinations", async () => {
  const invalidArgs = [
    [],
    ["--unknown", "repo"],
    ["repo", "--release-compat"],
    ["--release-compat"],
    ["--release-compat", "repo", "extra"],
  ];
  for (const args of invalidArgs) {
    await assert.rejects(execFileAsync(process.execPath, [PATCH_SCRIPT, ...args]), /Usage:/u);
  }
});
