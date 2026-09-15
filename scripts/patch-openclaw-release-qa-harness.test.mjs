import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  commitPatchWrites,
  isolatedAuthStoreWorker,
} from "./patch-openclaw-release-qa-harness.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH_SCRIPT = path.join(REPO_ROOT, "scripts/patch-openclaw-release-qa-harness.mjs");

const gatewaySetup = `async function prepareAttempt(configPath, cfg) {
        await fs.writeFile(configPath, \`\${JSON.stringify(cfg, null, 2)}\\n\`, {
          encoding: "utf8",
          mode: 0o600,
        });
}
`;
const authStore = `export async function writeQaAuthProfiles(params: {
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
  gateway = gatewaySetup,
  auth = authStore,
  liveGateway = liveGatewayConfig,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-patch-test-"));
  const gatewayPath = path.join(root, "extensions/qa-lab/src/gateway-child-setup.ts");
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

async function listTempFiles(dir) {
  return (await fs.readdir(dir)).filter((name) => name.startsWith(".tmp-"));
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
  assert.match(patchedAuth, /resolveReleaseAuthRuntimePath/u);
  // Candidate serialization must not mutate the parent process env: state dir
  // reaches the candidate runtime only through the spawned child's env.
  assert.doesNotMatch(patchedAuth, /process\.env\.OPENCLAW_STATE_DIR\s*=/u);
  assert.match(patchedAuth, /OPENCLAW_STATE_DIR: params\.stateDir/u);
  assert.match(patchedAuth, /spawn\(process\.execPath, \["--input-type=module", "--eval", worker\]/u);
  assert.match(patchedAuth, /updateAuthProfileStoreWithLock/u);

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
  assert.deepEqual(await listTempFiles(root), []);

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

// A fake candidate release auth runtime that binds its state root from the
// process env at call time, like the historical releases the patch targets.
// It records the observed env root and widens its write window so concurrent
// agents overlap, which would expose any cross-agent env sharing.
async function makeFakeReleaseAuthRuntime(dir) {
  const runtimePath = path.join(dir, "fake-release-auth-runtime.mjs");
  await fs.writeFile(
    runtimePath,
    `import fs from "node:fs";
import path from "node:path";

function readStateRoot() {
  const stateRoot = process.env.OPENCLAW_STATE_DIR;
  if (!stateRoot || stateRoot.trim() === "") {
    throw new Error("candidate release auth runtime requires OPENCLAW_STATE_DIR");
  }
  return stateRoot;
}

function storePath() {
  return path.join(readStateRoot(), "auth-profiles.json");
}

export function loadAuthProfileStoreWithoutExternalProfiles(agentDir, options) {
  if (options?.inheritedAuthDir !== agentDir) {
    throw new Error("unexpected inheritedAuthDir in load");
  }
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return { version: 0, profiles: {}, meta: { observedRoot: readStateRoot() } };
  }
}

export function saveAuthProfileStore(store, agentDir, options) {
  if (options?.filterExternalAuthProfiles !== false || options?.syncExternalCli !== false) {
    throw new Error("unexpected save options");
  }
  const deadline = Date.now() + 50;
  while (Date.now() < deadline) {
    // Busy-wait so concurrent seeding agents overlap inside the runtime.
  }
  store.meta = { ...store.meta, observedRoot: readStateRoot() };
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
}
`,
    "utf8",
  );
  return runtimePath;
}

function runIsolatedAuthStoreWorker({ agentDir, profiles, releaseAuthRuntimePath, replace, stateDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", isolatedAuthStoreWorker],
      {
        env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
        reject(
          new Error(
            `Isolated release auth store save failed (${signal ?? `exit ${code}`}): ${stderr.trim()}`,
          ),
        );
      }
    });
    child.stdin.end(
      JSON.stringify({ agentDir, profiles, releaseAuthRuntimePath, replace: Boolean(replace) }),
    );
  });
}

test("concurrent seeding agents keep their auth stores in disjoint state roots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-seed-isolation-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const runtimePath = await makeFakeReleaseAuthRuntime(root);
  const stateA = path.join(root, "state-a");
  const stateB = path.join(root, "state-b");
  const agentA = path.join(stateA, "agents/agent-a");
  const agentB = path.join(stateB, "agents/agent-b");
  await Promise.all([
    fs.mkdir(agentA, { recursive: true }),
    fs.mkdir(agentB, { recursive: true }),
  ]);

  await Promise.all([
    runIsolatedAuthStoreWorker({
      agentDir: agentA,
      profiles: { "pA@example.com": { type: "bearer", token: "token-a" } },
      releaseAuthRuntimePath: runtimePath,
      stateDir: stateA,
    }),
    runIsolatedAuthStoreWorker({
      agentDir: agentB,
      profiles: { "pB@example.com": { type: "bearer", token: "token-b" } },
      releaseAuthRuntimePath: runtimePath,
      stateDir: stateB,
    }),
  ]);

  assert.equal(process.env.OPENCLAW_STATE_DIR, undefined);
  const storeA = JSON.parse(await fs.readFile(path.join(stateA, "auth-profiles.json"), "utf8"));
  const storeB = JSON.parse(await fs.readFile(path.join(stateB, "auth-profiles.json"), "utf8"));
  assert.equal(storeA.meta.observedRoot, stateA);
  assert.equal(storeB.meta.observedRoot, stateB);
  assert.deepEqual(Object.keys(storeA.profiles), ["pA@example.com"]);
  assert.deepEqual(Object.keys(storeB.profiles), ["pB@example.com"]);
  assert.equal(storeA.version, 1);
  assert.equal(storeB.version, 1);

  // A replace=true write must wipe bookkeeping fields and leave the other
  // agent's store untouched.
  await runIsolatedAuthStoreWorker({
    agentDir: agentA,
    profiles: { "pA2@example.com": { type: "bearer", token: "token-a2" } },
    releaseAuthRuntimePath: runtimePath,
    replace: true,
    stateDir: stateA,
  });
  const replacedA = JSON.parse(await fs.readFile(path.join(stateA, "auth-profiles.json"), "utf8"));
  assert.deepEqual(Object.keys(replacedA.profiles), ["pA2@example.com"]);
  assert.equal(replacedA.order, undefined);
  assert.equal(replacedA.lastGood, undefined);
  assert.equal(replacedA.usageStats, undefined);
  const untouchedB = JSON.parse(await fs.readFile(path.join(stateB, "auth-profiles.json"), "utf8"));
  assert.deepEqual(Object.keys(untouchedB.profiles), ["pB@example.com"]);
});

test("isolated worker fails closed when the candidate runtime lacks the store contract", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-seed-failclosed-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const runtimePath = path.join(root, "incomplete-release-auth-runtime.mjs");
  await fs.writeFile(
    runtimePath,
    'export function loadAuthProfileStoreWithoutExternalProfiles() { return { profiles: {} }; }\n',
    "utf8",
  );
  const stateDir = path.join(root, "state");
  await fs.mkdir(path.join(stateDir, "agents/agent-a"), { recursive: true });

  await assert.rejects(
    runIsolatedAuthStoreWorker({
      agentDir: path.join(stateDir, "agents/agent-a"),
      profiles: { "p@example.com": { type: "bearer", token: "token" } },
      releaseAuthRuntimePath: runtimePath,
      stateDir,
    }),
    /must export loadAuthProfileStoreWithoutExternalProfiles and saveAuthProfileStore/u,
  );
});

test("commitPatchWrites restores already-renamed files when a later rename fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-rollback-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));

  const firstPath = path.join(root, "first.txt");
  const blockedDirPath = path.join(root, "blocked.txt");
  const lastPath = path.join(root, "last.txt");
  await fs.writeFile(firstPath, "first-original\n", "utf8");
  await fs.mkdir(blockedDirPath);
  await fs.writeFile(lastPath, "last-original\n", "utf8");

  await assert.rejects(
    commitPatchWrites([
      { contents: "first-patched\n", original: "first-original\n", path: firstPath },
      // Renaming a file onto an existing directory fails, after first.txt was
      // already committed.
      { contents: "blocked\n", path: blockedDirPath },
      { contents: "last-patched\n", original: "last-original\n", path: lastPath },
    ]),
    /release QA patch commit failed.*previously moved files were rolled back/u,
  );

  assert.equal(await fs.readFile(firstPath, "utf8"), "first-original\n");
  assert.equal(await fs.readFile(lastPath, "utf8"), "last-original\n");
  assert.deepEqual((await fs.stat(blockedDirPath)).isDirectory(), true);
  assert.deepEqual(await listTempFiles(root), []);
});

test("commitPatchWrites leaves targets untouched when a temp write fails mid-staging", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-qa-stagefail-"));
  t.after(async () => {
    await fs.chmod(path.join(root, "read-only"), 0o755);
    await fs.rm(root, { force: true, recursive: true });
  });

  const writableDir = path.join(root, "writable");
  const readOnlyDir = path.join(root, "read-only");
  await fs.mkdir(writableDir);
  await fs.mkdir(readOnlyDir);
  await fs.chmod(readOnlyDir, 0o555);
  const firstPath = path.join(writableDir, "first.txt");
  const blockedPath = path.join(readOnlyDir, "blocked.txt");
  const lastPath = path.join(writableDir, "last.txt");
  await Promise.all([
    fs.writeFile(firstPath, "first-original\n", "utf8"),
    fs.writeFile(lastPath, "last-original\n", "utf8"),
  ]);

  await assert.rejects(
    commitPatchWrites([
      { contents: "first-patched\n", original: "first-original\n", path: firstPath },
      { contents: "blocked-patched\n", original: "blocked-original\n", path: blockedPath },
      { contents: "last-patched\n", original: "last-original\n", path: lastPath },
    ]),
    /release QA patch commit failed/u,
  );

  assert.equal(await fs.readFile(firstPath, "utf8"), "first-original\n");
  assert.equal(await fs.readFile(lastPath, "utf8"), "last-original\n");
  assert.equal(await fs.access(blockedPath).then(() => true, () => false), false);
  assert.deepEqual(await listTempFiles(writableDir), []);
});
