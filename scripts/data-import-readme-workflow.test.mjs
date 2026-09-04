import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IMPORT_PATHS = [
  {
    name: "main Telegram",
    workflow: ".github/workflows/main-rtt.yml",
    importStep: "Import result",
    commitStep: "Commit result",
    mode: "main",
    stage: "git add data/channels/telegram/ runs/telegram/ README.md",
    pull: "git pull --rebase origin main",
    upstreamGuard: 'git rev-list --count "origin/main..HEAD"',
    retry: true,
  },
  {
    name: "main Discord",
    workflow: ".github/workflows/main-discord-rtt.yml",
    importStep: "Import Discord RTT result",
    commitStep: "Commit result",
    mode: "main",
    stage: "git add data/channels/discord/ runs/discord/ README.md",
    pull: "git pull --rebase origin main",
    upstreamGuard: 'git rev-list --count "origin/main..HEAD"',
    retry: true,
  },
  {
    name: "main channel",
    workflow: ".github/workflows/main-channel-rtt.yml",
    importStep: "Import channel RTT results",
    commitStep: "Commit result",
    mode: "main",
    stage: "git add data/channels/ runs/ README.md",
    pull: "git pull --rebase origin main",
    upstreamGuard: 'git rev-list --count "origin/main..HEAD"',
    retry: true,
  },
  {
    name: "main surface",
    workflow: ".github/workflows/main-surface-rtt.yml",
    importStep: "Validate imported Surface RTT",
    commitStep: "Commit imported Surface RTT",
    mode: "main",
    stage: "git add data/surfaces runs/surfaces README.md",
    pull: "git pull --rebase origin main",
    upstreamGuard: 'git rev-list --count "origin/main..HEAD"',
    retry: true,
  },
  {
    name: "release Telegram RSS backfill",
    workflow: ".github/workflows/stable-release-rtt.yml",
    importStep: "Run RSS backfill",
    commitStep: "Run RSS backfill",
    mode: "release",
    stage: "git add data/channels/telegram/ runs/telegram/ README.md",
    pull: 'git pull --rebase origin "${GITHUB_REF_NAME:-main}"',
    upstreamGuard: 'git rev-list --count "origin/${GITHUB_REF_NAME:-main}..HEAD"',
    retry: true,
  },
  {
    name: "release Telegram",
    workflow: ".github/workflows/stable-release-rtt.yml",
    importStep: "Import result",
    commitStep: "Commit result",
    mode: "release",
    stage: "git add data/channels/telegram/ runs/telegram/ README.md",
    pull: 'git pull --rebase origin "${GITHUB_REF_NAME:-main}"',
    upstreamGuard: 'git rev-list --count "origin/${GITHUB_REF_NAME:-main}..HEAD"',
    retry: true,
  },
  {
    name: "release Discord",
    workflow: ".github/workflows/stable-release-discord-rtt.yml",
    importStep: "Import Discord release RTT results",
    commitStep: "Commit result",
    mode: "release",
    stage: "git add data/channels/discord/ runs/discord/ README.md",
    pull: 'git pull --rebase origin "${GITHUB_REF_NAME:-main}"',
    upstreamGuard: 'git rev-list --count "origin/${GITHUB_REF_NAME:-main}..HEAD"',
    retry: true,
  },
  {
    name: "release channel",
    workflow: ".github/workflows/release-channel-rtt.yml",
    importStep: "Import channel release RTT results",
    commitStep: "Commit result",
    mode: "release",
    stage: "git add data/channels/ runs/ README.md",
    pull: 'git pull --rebase origin "${GITHUB_REF_NAME:-main}"',
    upstreamGuard: 'git rev-list --count "origin/${GITHUB_REF_NAME:-main}..HEAD"',
    retry: true,
  },
  {
    name: "release surface",
    workflow: ".github/workflows/release-surface-rtt.yml",
    importStep: "Import surface release RTT results",
    commitStep: "Commit result",
    mode: "release",
    stage: "git add data/surfaces/ runs/surfaces/ README.md",
    pull: 'git pull --rebase origin "${GITHUB_REF_NAME:-main}"',
    upstreamGuard: 'git rev-list --count "origin/${GITHUB_REF_NAME:-main}..HEAD"',
    retry: true,
  },
];

function extractStep(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

function extractRetry(step) {
  const start = step.indexOf("git push || {");
  assert.notEqual(start, -1, "missing push retry block");
  const lines = step.slice(start).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "}");
  assert.notEqual(end, -1, "unterminated push retry block");
  return lines.slice(1, end).join("\n");
}

function assertOrdered(contents, commands, context) {
  let offset = 0;
  for (const command of commands) {
    const index = contents.indexOf(command, offset);
    assert.notEqual(index, -1, `${context}: missing or out-of-order command: ${command}`);
    offset = index + command.length;
  }
}

function readmeCommand(mode) {
  return mode === "main"
    ? 'node "$RTT_SCRIPTS_DIR/update-readme.mjs" --latest-main-only'
    : 'node "$RTT_SCRIPTS_DIR/update-readme.mjs"';
}

test("all nine data import paths update README atomically", async (t) => {
  assert.equal(IMPORT_PATHS.length, 9);
  const workflowCache = new Map();

  for (const pathConfig of IMPORT_PATHS) {
    await t.test(pathConfig.name, async () => {
      let workflow = workflowCache.get(pathConfig.workflow);
      if (!workflow) {
        workflow = await fs.readFile(path.join(REPO_ROOT, pathConfig.workflow), "utf8");
        workflowCache.set(pathConfig.workflow, workflow);
      }

      const generation = readmeCommand(pathConfig.mode);
      const importStep = extractStep(workflow, pathConfig.importStep);
      const commitStep = extractStep(workflow, pathConfig.commitStep);

      assertOrdered(
        importStep,
        [generation, 'node "$RTT_SCRIPTS_DIR/validate.mjs"'],
        `${pathConfig.name} initial import`,
      );
      assert.match(
        commitStep,
        new RegExp(`^\\s*${pathConfig.stage.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
        `${pathConfig.name} must stage README.md with imported data`,
      );

      const generationLine = importStep
        .split("\n")
        .find((line) =>
          line.trim().startsWith('node "$RTT_SCRIPTS_DIR/update-readme.mjs"'),
        );
      assert.equal(generationLine?.trim(), generation, `${pathConfig.name} uses the wrong README mode`);

      if (!pathConfig.retry) {
        assert.doesNotMatch(commitStep, /git push \|\| \{/u);
        return;
      }

      const retry = extractRetry(commitStep);
      assertOrdered(
        retry,
        [
          "git restore --source=HEAD^ --staged --worktree README.md",
          "git commit --amend --no-edit",
          pathConfig.pull,
          pathConfig.upstreamGuard,
          "exit 0",
          generation,
          'node "$RTT_SCRIPTS_DIR/validate.mjs"',
          "git add README.md",
          "git commit --amend --no-edit",
          "git push",
        ],
        `${pathConfig.name} push retry`,
      );
    });
  }
});
