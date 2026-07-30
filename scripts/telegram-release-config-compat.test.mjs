import assert from "node:assert/strict";
import test from "node:test";

import { adaptTelegramReleaseGatewayConfig } from "./telegram-release-config-compat.mjs";

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
  });
}

for (const packageSpec of [
  "openclaw@2026.7.2-beta.4",
  "openclaw@2026.7.2-beta.5",
  "openclaw@2026.7.2",
  "openclaw@main",
  "openclaw@2026.7.2-beta.3-extra",
]) {
  test(`preserves current config for ${packageSpec}`, () => {
    const config = currentConfig();
    assert.strictEqual(adaptTelegramReleaseGatewayConfig(config, packageSpec), config);
  });
}
