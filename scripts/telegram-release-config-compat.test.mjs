import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptTelegramReleaseGatewayConfig,
  resolveTelegramReleaseAuthRuntimePath,
} from "./telegram-release-config-compat.mjs";

const RELEASE_AUTH_RUNTIME_PATH =
  "/npm-global/lib/node_modules/openclaw/dist/plugin-sdk/agent-runtime.js";

function currentConfig() {
  return {
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

for (const packageSpec of [
  "openclaw@2026.6.33",
  "openclaw@2026.7.1-beta.6",
  "openclaw@2026.7.1",
  "openclaw@2026.7.2-beta.2",
  "openclaw@2026.7.2-beta.3",
]) {
  test(`adapts legacy config for ${packageSpec}`, () => {
    const config = currentConfig();
    const adapted = adaptTelegramReleaseGatewayConfig(config, packageSpec);

    assert.notStrictEqual(adapted, config);
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
    assert.equal(resolveTelegramReleaseAuthRuntimePath(packageSpec), RELEASE_AUTH_RUNTIME_PATH);
  });
}

for (const packageSpec of [
  "openclaw@2026.7.2-beta.4",
  "openclaw@2026.7.2-beta.5",
  "openclaw@2026.7.2",
  "openclaw@main",
  "openclaw@latest",
  "openclaw@beta",
  "openclaw@2026.7.2-beta.3-extra",
]) {
  test(`preserves current config for ${packageSpec}`, () => {
    const config = currentConfig();
    assert.strictEqual(adaptTelegramReleaseGatewayConfig(config, packageSpec), config);
    assert.equal(
      resolveTelegramReleaseAuthRuntimePath(packageSpec),
      RELEASE_AUTH_RUNTIME_PATH,
    );
  });
}

test("does not select the installed auth runtime without an OpenClaw package spec", () => {
  assert.equal(resolveTelegramReleaseAuthRuntimePath(undefined), undefined);
  assert.equal(resolveTelegramReleaseAuthRuntimePath(""), undefined);
  assert.equal(resolveTelegramReleaseAuthRuntimePath("other@latest"), undefined);
});
