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
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-release-qa-harness.mjs");

const gatewayChild = `async function startGateway(configPath, cfg) {
      await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
        encoding: "utf8",
        mode: 0o600,
      });
}
`;
const authStore = `export async function writeQaAuthProfiles(params: {
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
const liveGatewayConfig = `import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";

function isStaleConfigPatchError(error: unknown) {
  return formatErrorMessage(error).toLowerCase().includes("config changed since last load");
}

async function waitForLiveQaGatewayConfigApplied() {}

export async function patchLiveQaGatewayConfig(params) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readLiveQaGatewayConfig(params.gateway);
    let patchResult: { hash?: string; noop?: boolean };
    try {
      patchResult =
        ((await params.gateway.call(
          "config.patch",
          {
            raw: JSON.stringify(params.patch, null, 2),
            baseHash: snapshot.hash,
            ...(params.replacePaths?.length ? { replacePaths: params.replacePaths } : {}),
            restartDelayMs: 0,
          },
          { timeoutMs: 60_000 },
        )) as { noop?: boolean } | null | undefined) ?? {};
    } catch (error) {
      if (attempt === 0 && isStaleConfigPatchError(error)) {
        continue;
      }
      throw error;
    }
    return patchResult;
  }
}
`;

async function makeFixture({
  gateway = gatewayChild,
  auth = authStore,
  liveGateway = liveGatewayConfig,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-patch-test-"));
  const gatewayPath = path.join(root, "extensions/qa-lab/src/gateway-child.ts");
  const authPath = path.join(root, "extensions/qa-lab/src/providers/shared/auth-store.ts");
  const liveGatewayPath = path.join(
    root,
    "extensions/qa-lab/src/live-transports/shared/live-gateway-config.runtime.ts",
  );
  await fs.mkdir(path.dirname(gatewayPath), { recursive: true });
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.mkdir(path.dirname(liveGatewayPath), { recursive: true });
  await Promise.all([
    fs.writeFile(gatewayPath, gateway),
    fs.writeFile(authPath, auth),
    fs.writeFile(liveGatewayPath, liveGateway),
  ]);
  return { authPath, gatewayPath, liveGatewayPath, root };
}

test("patches release config and auth serialization contracts idempotently", async (t) => {
  const { authPath, gatewayPath, liveGatewayPath, root } = await makeFixture();
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const first = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(first.stdout, /patched 4 release QA compatibility contracts/u);

  const patchedGateway = await fs.readFile(gatewayPath, "utf8");
  assert.match(patchedGateway, /rtt-release-qa-config-compat\.mjs/u);
  assert.match(patchedGateway, /OPENCLAW_QA_RELEASE_PACKAGE_SPEC/u);
  assert.match(patchedGateway, /JSON\.stringify\(releaseCompatibleConfig, null, 2\)/u);

  const patchedAuth = await fs.readFile(authPath, "utf8");
  assert.match(patchedAuth, /OPENCLAW_QA_RELEASE_AUTH_RUNTIME_PATH/u);
  assert.match(patchedAuth, /releaseAuthRuntime\?\.saveAuthProfileStore \?\? saveAuthProfileStore/u);
  assert.match(patchedAuth, /process\.env\.OPENCLAW_STATE_DIR = path\.resolve/u);
  assert.ok(
    patchedAuth.indexOf("process.env.OPENCLAW_STATE_DIR = path.resolve") <
      patchedAuth.indexOf("await releaseCompat.resolveReleaseAuthRuntime"),
  );

  const patchedLiveGateway = await fs.readFile(liveGatewayPath, "utf8");
  assert.match(patchedLiveGateway, /function isUnsupportedReplacePathsError/u);
  assert.match(patchedLiveGateway, /message\.includes\("unexpected property"\)/u);
  assert.match(patchedLiveGateway, /patchResult = await callConfigPatch\(true\)/u);
  assert.match(patchedLiveGateway, /patchResult = await callConfigPatch\(false\)/u);
  assert.ok(
    patchedLiveGateway.indexOf("isUnsupportedReplacePathsError(error)") <
      patchedLiveGateway.indexOf("patchResult = await callConfigPatch(false)"),
  );

  const compatModulePath = path.join(
    root,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.mjs",
  );
  const compatDeclarationPath = path.join(
    root,
    "extensions/qa-lab/src/rtt-release-qa-config-compat.d.mts",
  );
  assert.equal(
    await fs.readFile(compatModulePath, "utf8"),
    await fs.readFile(path.join(REPO_ROOT, "scripts/release-qa-config-compat.mjs"), "utf8"),
  );
  assert.equal(
    await fs.readFile(compatDeclarationPath, "utf8"),
    await fs.readFile(path.join(REPO_ROOT, "scripts/release-qa-config-compat.d.mts"), "utf8"),
  );

  const second = await execFileAsync(process.execPath, [PATCH_SCRIPT, root]);
  assert.match(second.stdout, /already patched/u);
  assert.equal(await fs.readFile(gatewayPath, "utf8"), patchedGateway);
  assert.equal(await fs.readFile(authPath, "utf8"), patchedAuth);
  assert.equal(await fs.readFile(liveGatewayPath, "utf8"), patchedLiveGateway);
});

test("fails closed when the upstream release QA contract changes", async (t) => {
  const { root } = await makeFixture({ gateway: "export const changed = true;\n" });
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [PATCH_SCRIPT, root]),
    /Unsupported release QA gateway config contract/u,
  );
});
