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
      defaults: {
        workspace: "/tmp/qa",
        model: "mock-openai/qa",
        models: {
          "mock-openai/qa": {},
          "mock-openai/qa-fast": {},
        },
        modelPolicy: {
          allow: ["mock-openai/qa", "mock-openai/qa-fast"],
        },
        mediaModels: {
          image: {
            primary: "mock-openai/qa-image",
          },
        },
        subagents: {
          allowAgents: ["*"],
          maxConcurrent: 2,
        },
      },
      entries: {
        qa: {
          model: "mock-openai/qa",
          identity: {
            name: "C-3PO QA",
          },
        },
      },
    },
    memory: {
      search: {
        provider: "openai-compatible",
        model: "text-embedding-3-small",
        remote: {
          baseUrl: "http://127.0.0.1:12345/v1",
          apiKey: "test",
        },
      },
    },
    models: {
      providers: {
        "openai-compatible": {
          api: "openai-responses",
          baseUrl: "http://127.0.0.1:12345/v1",
        },
      },
    },
    plugins: {
      enabled: true,
    },
  };
}

test("projects the current Discord QA config into the legacy release shape", () => {
  const config = currentConfig();
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.notStrictEqual(adapted, config);
  assert.deepEqual(adapted.meta, { lastTouchedVersion: "2026.7.1-1" });
  assert.deepEqual(adapted.agents, {
    defaults: {
      workspace: "/tmp/qa",
      model: "mock-openai/qa",
      models: {
        "mock-openai/qa": {},
        "mock-openai/qa-fast": {},
      },
      imageGenerationModel: {
        primary: "mock-openai/qa-image",
      },
      memorySearch: {
        provider: "openai-compatible",
        model: "text-embedding-3-small",
        remote: {
          baseUrl: "http://127.0.0.1:12345/v1",
          apiKey: "test",
        },
      },
      subagents: {
        allowAgents: ["*"],
        maxConcurrent: 2,
      },
    },
    list: [
      {
        id: "qa",
        model: "mock-openai/qa",
        identity: {
          name: "C-3PO QA",
        },
      },
    ],
  });
  assert.deepEqual(adapted.memory, {});
  assert.equal(
    adapted.models.providers["openai-compatible"],
    config.models.providers["openai-compatible"],
  );
  assert.deepEqual(adapted.plugins, config.plugins);
  assert.deepEqual(config, currentConfig());
});

test("uses the beta.4 boundary for legacy config projection", () => {
  for (const packageSpec of ["openclaw@2026.7.1-1", "openclaw@2026.7.2-beta.3"]) {
    const adapted = adaptReleaseGatewayConfig(currentConfig(), packageSpec);
    assert.ok(adapted.agents.list, packageSpec);
    assert.equal(adapted.agents.entries, undefined, packageSpec);
    assert.equal(adapted.agents.defaults.modelPolicy, undefined, packageSpec);
    assert.equal(adapted.agents.defaults.mediaModels, undefined, packageSpec);
    assert.ok(adapted.agents.defaults.memorySearch, packageSpec);
    assert.equal(adapted.memory.search, undefined, packageSpec);
  }

  for (const packageSpec of [
    "openclaw@2026.7.2-beta.4",
    "openclaw@2026.7.2",
    "openclaw@2026.7.2-1",
  ]) {
    const config = currentConfig();
    const adapted = adaptReleaseGatewayConfig(config, packageSpec);
    assert.deepEqual(
      adapted,
      {
        ...config,
        meta: { lastTouchedVersion: packageSpec.slice("openclaw@".length) },
      },
      packageSpec,
    );
  }
});

test("does not synthesize absent legacy config fields", () => {
  const config = {
    meta: { mode: "test" },
    plugins: { enabled: true },
  };
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted, {
    meta: {
      mode: "test",
      lastTouchedVersion: "2026.7.1-1",
    },
    plugins: { enabled: true },
  });
  assert.equal(Object.hasOwn(adapted, "agents"), false);
  assert.equal(Object.hasOwn(adapted, "memory"), false);
});

test("maps every media model and preserves existing legacy memory settings", () => {
  const config = currentConfig();
  config.agents.defaults.mediaModels.video = {
    primary: "mock-openai/qa-video",
  };
  config.agents.defaults.mediaModels.music = {
    primary: "mock-openai/qa-music",
  };
  config.memory.backend = "builtin";
  config.memory.citations = "auto";
  config.memory.qmd = {
    command: "mock-qmd",
  };
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted.agents.defaults.imageGenerationModel, {
    primary: "mock-openai/qa-image",
  });
  assert.deepEqual(adapted.agents.defaults.videoGenerationModel, {
    primary: "mock-openai/qa-video",
  });
  assert.deepEqual(adapted.agents.defaults.musicGenerationModel, {
    primary: "mock-openai/qa-music",
  });
  assert.deepEqual(adapted.memory, {
    backend: "builtin",
    citations: "auto",
    qmd: {
      command: "mock-qmd",
    },
  });
});

test("projects per-agent memory search and model policy into the legacy entry shape", () => {
  const config = currentConfig();
  config.agents.entries.qa.modelPolicy = {
    allow: ["mock-openai/qa"],
  };
  config.agents.entries.qa.memory = {
    search: {
      provider: "openai-compatible",
      model: "text-embedding-3-small",
    },
  };
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted.agents.list[0], {
    id: "qa",
    model: "mock-openai/qa",
    identity: {
      name: "C-3PO QA",
    },
    memorySearch: {
      provider: "openai-compatible",
      model: "text-embedding-3-small",
    },
  });
});

test("synthesizes the legacy memory-search owner when agents are absent", () => {
  const config = {
    memory: {
      search: {
        provider: "local",
      },
      backend: "builtin",
    },
  };
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted, {
    meta: {
      lastTouchedVersion: "2026.7.1-1",
    },
    agents: {
      defaults: {
        memorySearch: {
          provider: "local",
        },
      },
    },
    memory: {
      backend: "builtin",
    },
  });
});

test("retains unknown semantic fields for historical strict validation", () => {
  const config = currentConfig();
  config.agents.defaults.mediaModels.speech = {
    primary: "mock-openai/qa-speech",
  };
  config.memory.experimentalSearchPolicy = {
    mode: "future",
  };
  config.agents.entries.qa.memory = {
    search: {
      provider: "local",
    },
    futurePolicy: {
      mode: "future",
    },
  };
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted.agents.defaults.mediaModels, {
    speech: {
      primary: "mock-openai/qa-speech",
    },
  });
  assert.deepEqual(adapted.memory.experimentalSearchPolicy, {
    mode: "future",
  });
  assert.deepEqual(adapted.agents.list[0].memory, {
    futurePolicy: {
      mode: "future",
    },
  });
});

test("retains malformed new-shape fields instead of silently discarding them", () => {
  const config = currentConfig();
  config.agents.entries = ["qa"];
  config.agents.defaults.mediaModels = ["mock-openai/qa-image"];
  config.agents.defaults.modelPolicy = ["mock-openai/qa"];
  const adapted = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");

  assert.deepEqual(adapted.agents.entries, ["qa"]);
  assert.deepEqual(adapted.agents.defaults.mediaModels, ["mock-openai/qa-image"]);
  assert.deepEqual(adapted.agents.defaults.modelPolicy, ["mock-openai/qa"]);
  assert.equal(adapted.agents.list, undefined);
});

test("legacy projection is idempotent and does not mutate its input", () => {
  const config = currentConfig();
  const snapshot = structuredClone(config);
  const first = adaptReleaseGatewayConfig(config, "openclaw@2026.7.1-1");
  const second = adaptReleaseGatewayConfig(first, "openclaw@2026.7.1-1");

  assert.deepEqual(config, snapshot);
  assert.deepEqual(second, first);
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
  assert.strictEqual(adaptReleaseGatewayConfig(undefined, "openclaw@2026.7.1-1"), undefined);
});
