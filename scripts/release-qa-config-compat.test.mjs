import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptReleaseGatewayConfig,
  resolveReleaseAuthRuntimePath,
} from "./release-qa-config-compat.mjs";

function currentConfig() {
  return {
    meta: { lastTouchedVersion: "2026.7.2" },
    agents: {
      defaults: { workspace: "/tmp/qa" },
      entries: {
        qa: {
          default: true,
          model: "mock-openai/qa",
        },
      },
    },
    memory: {
      backend: "builtin",
      search: {
        enabled: false,
      },
    },
    plugins: {
      enabled: true,
    },
  };
}

test("adapts legacy release config and stamps the candidate version", () => {
  const config = currentConfig();
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.6.33");

  assert.notStrictEqual(adapted, config);
  assert.deepEqual(adapted.meta, { lastTouchedVersion: "2026.6.33" });
  assert.deepEqual(adapted.agents, {
    defaults: { workspace: "/tmp/qa" },
    list: [
      {
        default: true,
        id: "qa",
        model: "mock-openai/qa",
      },
    ],
  });
  assert.deepEqual(adapted.memory, { backend: "builtin" });
  assert.deepEqual(adapted.plugins, config.plugins);
  assert.deepEqual(config, currentConfig());
});

test("preserves current config shape while stamping beta releases", () => {
  const config = currentConfig();
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.2-beta.4");

  assert.deepEqual(adapted, {
    ...config,
    meta: { lastTouchedVersion: "2026.7.2-beta.4" },
  });
});

test("adapts historical numeric post releases before the config cutoff", () => {
  const config = currentConfig();
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-2");

  assert.deepEqual(adapted.meta, { lastTouchedVersion: "2026.7.1-2" });
  assert.deepEqual(adapted.agents, {
    defaults: { workspace: "/tmp/qa" },
    list: [
      {
        default: true,
        id: "qa",
        model: "mock-openai/qa",
      },
    ],
  });
  assert.deepEqual(adapted.memory, { backend: "builtin" });
});

test("preserves current config shape for numeric post releases after the cutoff", () => {
  const config = currentConfig();
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.2-1");

  assert.deepEqual(adapted, {
    ...config,
    meta: { lastTouchedVersion: "2026.7.2-1" },
  });
});

test("selects the candidate auth runtime only for exact release specs", () => {
  const runtimePath = "/tmp/openclaw/dist/plugin-sdk/agent-runtime.js";
  assert.equal(
    resolveReleaseAuthRuntimePath("openclaw@2026.7.2-beta.4", runtimePath),
    runtimePath,
  );
  assert.equal(resolveReleaseAuthRuntimePath("openclaw@2026.7.1-2", runtimePath), runtimePath);
  assert.equal(resolveReleaseAuthRuntimePath("openclaw@main", runtimePath), undefined);
  assert.equal(resolveReleaseAuthRuntimePath("other@2026.7.2", runtimePath), undefined);
  assert.equal(resolveReleaseAuthRuntimePath("openclaw@2026.7.1-0", runtimePath), undefined);
  assert.equal(resolveReleaseAuthRuntimePath("openclaw@2026.7.1-rc.1", runtimePath), undefined);
  assert.equal(resolveReleaseAuthRuntimePath("openclaw@2026.7.2", ""), undefined);
});

test("leaves non-release configs untouched", () => {
  const config = currentConfig();
  assert.strictEqual(adaptReleaseGatewayConfig(config, "openclaw@main"), config);
  assert.strictEqual(adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-rc.1"), config);
  assert.strictEqual(adaptReleaseGatewayConfig(config, undefined), config);
});
