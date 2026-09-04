import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release-channel-rtt.yml", import.meta.url);
const cachePin = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9";

function extractStep(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const step = workflow.split(marker)[1]?.split("\n      - name: ")[0];
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

function stepIndex(workflow, name) {
  const index = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(index, -1, `missing workflow step: ${name}`);
  return index;
}

test("benchmark dispatch can skip publication without changing schedule behavior", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");
  assert.match(
    workflow,
    /publish_results:\n\s+description: Import successful measurements into the RTT tracker\n\s+required: false\n\s+default: true\n\s+type: boolean/u,
  );
  assert.match(
    workflow,
    /if: always\(\) && needs\.resolve\.outputs\.should_run == 'true' && \(github\.event_name != 'workflow_dispatch' \|\| inputs\.publish_results\)/u,
  );
});

test("release and QA native build caches use exact source identities", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");
  const identity = extractStep(workflow, "Resolve OpenClaw build cache identity");

  assert.match(identity, /node_version="\$\(node --version\)"/u);
  assert.match(identity, /pnpm_version="\$\(pnpm --version\)"/u);
  assert.match(identity, /release_head="\$\(git -C openclaw rev-parse HEAD\)"/u);
  assert.match(identity, /qa_head="\$\(git -C openclaw-qa rev-parse HEAD\)"/u);
  assert.match(identity, /git -C openclaw-qa diff --binary --no-ext-diff HEAD --/u);
  assert.match(identity, /git -C openclaw-qa ls-files --others --exclude-standard -z/u);
  assert.match(identity, /sha256sum \| cut -d' ' -f1/u);
  assert.match(
    identity,
    /identity="openclaw-release-channel-rtt-build-v1-\$\{CACHE_OS\}-\$\{CACHE_ARCH\}-node-\$\{node_version\}-pnpm-\$\{pnpm_version\}-full-private-qa"/u,
  );
  assert.match(
    identity,
    /printf 'release_key=%s-release-%s\\n' "\$identity" "\$release_head"/u,
  );
  assert.match(
    identity,
    /printf 'qa_key=%s-qa-%s-patch-%s\\n' "\$identity" "\$qa_head" "\$qa_patch_digest"/u,
  );
  assert.doesNotMatch(identity, /restore_prefix|save_suffix|GITHUB_RUN_ID|GITHUB_RUN_ATTEMPT/u);
});

test("native cache restore and save tightly wrap both full builds", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");
  const names = [
    "Restore OpenClaw release build cache",
    "Build OpenClaw release",
    "Save OpenClaw release build cache",
    "Restore OpenClaw QA harness build cache",
    "Build OpenClaw QA harness",
    "Save OpenClaw QA harness build cache",
  ];
  const indices = names.map((name) => stepIndex(workflow, name));
  assert.deepEqual(indices, indices.toSorted((left, right) => left - right));

  const releaseRestore = extractStep(workflow, names[0]);
  const releaseSave = extractStep(workflow, names[2]);
  const qaRestore = extractStep(workflow, names[3]);
  const qaSave = extractStep(workflow, names[5]);

  for (const step of [releaseRestore, qaRestore]) {
    assert.match(step, new RegExp(`uses: actions/cache/restore@${cachePin} # v6\\.1\\.0`, "u"));
  }
  for (const step of [releaseSave, qaSave]) {
    assert.match(step, new RegExp(`uses: actions/cache/save@${cachePin} # v6\\.1\\.0`, "u"));
  }
  assert.match(releaseRestore, /path: openclaw\/\.artifacts\/build-all-cache/u);
  assert.match(releaseSave, /path: openclaw\/\.artifacts\/build-all-cache/u);
  assert.match(qaRestore, /path: openclaw-qa\/\.artifacts\/build-all-cache/u);
  assert.match(qaSave, /path: openclaw-qa\/\.artifacts\/build-all-cache/u);
  assert.match(releaseRestore, /id: restore_release_build_cache/u);
  assert.match(releaseRestore, /key: \$\{\{ steps\.build_cache\.outputs\.release_key \}\}/u);
  assert.doesNotMatch(releaseRestore, /restore-keys:/u);
  assert.match(qaRestore, /id: restore_qa_build_cache/u);
  assert.match(qaRestore, /key: \$\{\{ steps\.build_cache\.outputs\.qa_key \}\}/u);
  assert.doesNotMatch(qaRestore, /restore-keys:/u);
  assert.match(
    releaseSave,
    /if: steps\.restore_release_build_cache\.outputs\.cache-hit != 'true'/u,
  );
  assert.match(
    releaseSave,
    /key: \$\{\{ steps\.restore_release_build_cache\.outputs\.cache-primary-key \}\}/u,
  );
  assert.match(
    qaSave,
    /if: steps\.restore_qa_build_cache\.outputs\.cache-hit != 'true'/u,
  );
  assert.match(
    qaSave,
    /key: \$\{\{ steps\.restore_qa_build_cache\.outputs\.cache-primary-key \}\}/u,
  );
  assert.equal((workflow.match(/\btime pnpm build$/gmu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /pnpm build:ci-artifacts/u);
});
