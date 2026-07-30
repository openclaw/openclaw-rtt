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

async function makeFixture({
  harness = legacyHarness,
  preparePackage = legacyPreparePackage,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-harness-test-"));
  const scriptPath = path.join(root, "scripts/e2e/npm-telegram-live-docker.sh");
  const preparePackagePath = path.join(
    root,
    "scripts/e2e/lib/npm-telegram-live/prepare-package.mjs",
  );
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.mkdir(path.dirname(preparePackagePath), { recursive: true });
  await Promise.all([
    fs.writeFile(scriptPath, harness),
    fs.writeFile(preparePackagePath, preparePackage),
  ]);
  return { preparePackagePath, root, scriptPath };
}

test("separates the trusted QA harness from the installed package SUT", async (t) => {
  const { preparePackagePath, root, scriptPath } = await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched 2 Telegram harness stdin consumers/u);
  assert.match(first.stdout, /patched 3 package harness contracts/u);

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
  assert.match(patched, /cp \/openclaw-harness\/package\.json \/app\/package\.json/u);
  assert.match(patched, /ln -sfnT \/openclaw-harness\/dist \/app\/dist/u);
  assert.match(patched, /for dependency_dir in \/openclaw-harness\/node_modules\/\*; do/u);
  assert.match(patched, /ln -sfnT \/app \/app\/node_modules\/openclaw/u);
  assert.doesNotMatch(patched, /openclaw_package_dir=/u);
  assert.doesNotMatch(patched, /link_installed_package_dependency/u);

  const patchedPreparePackage = await fs.readFile(preparePackagePath, "utf8");
  assert.match(patchedPreparePackage, /"\.\/plugin-sdk\/qa-runtime"/u);
  assert.match(patchedPreparePackage, /\.\/dist\/plugin-sdk\/qa-runtime\.js/u);

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /preserved Telegram harness stdin consumers/u);
  assert.match(second.stdout, /package harness contracts already patched/u);
  assert.equal(await fs.readFile(scriptPath, "utf8"), patched);
  assert.equal(await fs.readFile(preparePackagePath, "utf8"), patchedPreparePackage);
});

test("fails closed for an unknown upstream Telegram harness contract", async (t) => {
  const { root } = await makeFixture({ harness: "#!/usr/bin/env bash\necho unknown\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported Telegram harness logging contract/u,
  );
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
    { harness: legacyHarness.replace('openclaw_package_dir="/npm-global/lib/node_modules/openclaw"', "echo custom") },
    { preparePackage: legacyPreparePackage.replace("fs.writeFileSync", "customWrite") },
  ];
  const roots = [];
  t.after(() => Promise.all(roots.map((root) => fs.rm(root, { force: true, recursive: true }))));

  for (const fixture of fixtures) {
    const { root } = await makeFixture(fixture);
    roots.push(root);
    await assert.rejects(
      execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
      /Unsupported Telegram harness (mount|package contract|package manifest)/u,
    );
  }
});
