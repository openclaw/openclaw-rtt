import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_ROOT = path.join(REPO_ROOT, "scripts");
const WORKFLOW_FILES = [
  ".github/workflows/main-rtt.yml",
  ".github/workflows/main-discord-rtt.yml",
  ".github/workflows/main-channel-rtt.yml",
  ".github/workflows/main-surface-rtt.yml",
  ".github/workflows/stable-release-rtt.yml",
  ".github/workflows/stable-release-discord-rtt.yml",
  ".github/workflows/release-channel-rtt.yml",
  ".github/workflows/release-surface-rtt.yml",
];
const WRITER_PATHS = [
  {
    name: "main Telegram",
    workflow: ".github/workflows/main-rtt.yml",
    writerStep: "Import result",
    checkoutPath: "openclaw-rtt",
  },
  {
    name: "main Discord",
    workflow: ".github/workflows/main-discord-rtt.yml",
    writerStep: "Import Discord RTT result",
    checkoutPath: "openclaw-rtt",
  },
  {
    name: "main channel",
    workflow: ".github/workflows/main-channel-rtt.yml",
    writerStep: "Import channel RTT results",
  },
  {
    name: "main surface",
    workflow: ".github/workflows/main-surface-rtt.yml",
    writerStep: "Refresh RTT tracker",
  },
  {
    name: "release Telegram RSS backfill",
    workflow: ".github/workflows/stable-release-rtt.yml",
    writerStep: "Run RSS backfill",
    checkoutPath: "openclaw-rtt",
  },
  {
    name: "release Telegram",
    workflow: ".github/workflows/stable-release-rtt.yml",
    writerStep: "Import result",
    checkoutPath: "openclaw-rtt",
  },
  {
    name: "release Discord",
    workflow: ".github/workflows/stable-release-discord-rtt.yml",
    writerStep: "Import Discord release RTT results",
  },
  {
    name: "release channel",
    workflow: ".github/workflows/release-channel-rtt.yml",
    writerStep: "Import channel release RTT results",
  },
  {
    name: "release surface",
    workflow: ".github/workflows/release-surface-rtt.yml",
    writerStep: "Import surface release RTT results",
  },
];
const EXPECTED_ENTRYPOINTS = [
  "backfill-release-rss.mjs",
  "channel-rtt-summary.mjs",
  "discord-rtt-summary.mjs",
  "handle-missing-release-imports.mjs",
  "import-discord-rtt.mjs",
  "import-live-transport-rtt.mjs",
  "import-result.mjs",
  "import-surface-rtt.mjs",
  "measure-control-ui-rtt.mjs",
  "measure-rpc-rtt.mjs",
  "summary.mjs",
  "surface-rtt-summary.mjs",
  "update-readme.mjs",
  "validate.mjs",
];
const ALLOWED_DYNAMIC_IMPORTS = new Map([
  ["measure-control-ui-rtt.mjs", ["helperUrl"]],
  ["measure-rpc-rtt.mjs", ["clientUrl"]],
]);

function workflowSteps(contents) {
  const matches = [...contents.matchAll(/^      - name: (.+)$/gmu)];
  return matches.map((match, index) => ({
    contents: contents.slice(match.index, matches[index + 1]?.index ?? contents.length),
    index: match.index,
    name: match[1],
  }));
}

function moduleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /^\s*import\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gmu,
    /^\s*export\s+[^"']*?\s+from\s+["']([^"']+)["']/gmu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function dynamicImportExpressions(source) {
  return [...source.matchAll(/\bimport\s*\(\s*([^)\r\n]+?)\s*\)/gu)]
    .map((match) => match[1])
    .filter((expression) => !/^["'][^"']+["']$/u.test(expression));
}

test("all eight workflows snapshot scripts before nine writer pulls", async (t) => {
  assert.equal(WORKFLOW_FILES.length, 8);
  assert.equal(WRITER_PATHS.length, 9);
  const workflowCache = new Map();
  const pinnedEntrypoints = new Set();

  for (const writer of WRITER_PATHS) {
    await t.test(writer.name, async () => {
      let contents = workflowCache.get(writer.workflow);
      if (!contents) {
        contents = await fs.readFile(path.join(REPO_ROOT, writer.workflow), "utf8");
        workflowCache.set(writer.workflow, contents);
      }
      const steps = workflowSteps(contents);
      const writerIndex = steps.findIndex((step) => step.name === writer.writerStep);
      assert.notEqual(writerIndex, -1, `${writer.workflow}: missing ${writer.writerStep}`);
      const checkoutIndex = steps.findLastIndex(
        (step, index) => index < writerIndex && step.name === "Checkout RTT tracker",
      );
      assert.notEqual(checkoutIndex, -1, `${writer.workflow}: missing writer checkout`);

      const checkout = steps[checkoutIndex];
      const archive = steps[checkoutIndex + 1];
      const writerStep = steps[writerIndex];
      assert.equal(
        archive?.name,
        "Archive workflow scripts",
        `${writer.name}: archive must immediately follow the writer checkout`,
      );
      if (writer.checkoutPath) {
        assert.match(checkout.contents, new RegExp(`path: ${writer.checkoutPath}\\n`, "u"));
        assert.match(
          archive.contents,
          new RegExp(`working-directory: ${writer.checkoutPath}\\n`, "u"),
        );
      } else {
        assert.doesNotMatch(archive.contents, /working-directory:/u);
      }
      assert.match(
        archive.contents,
        /scripts_archive_dir="\$\(mktemp -d "\$RUNNER_TEMP\/rtt-workflow-scripts\.XXXXXX"\)"/u,
      );
      assert.match(
        archive.contents,
        /git archive "\$\{\{ github\.workflow_sha \}\}" scripts \| tar -x -C "\$scripts_archive_dir"/u,
      );
      assert.match(
        archive.contents,
        /printf 'RTT_SCRIPTS_DIR=%s\\n' "\$scripts_archive_dir\/scripts" >>"\$GITHUB_ENV"/u,
      );
      assert.doesNotMatch(archive.contents, /^\s*cd /mu);

      const pullIndex = writerStep.contents.indexOf("git pull --rebase");
      assert.notEqual(pullIndex, -1, `${writer.name}: writer must update its checkout`);
      assert.ok(archive.index < writerStep.index, `${writer.name}: archive must precede the pull`);
      const absolutePullIndex = writerStep.index + pullIndex;
      const afterPull = contents.slice(absolutePullIndex);
      assert.doesNotMatch(
        afterPull,
        /\bnode\s+(?:--import\s+tsx\s+)?(?:scripts\/|(?:\.\.\/|\$\{[^}]+\}\/)openclaw-rtt\/scripts\/)[^\s\\]+\.mjs/u,
        `${writer.name}: post-pull RTT entrypoint must use RTT_SCRIPTS_DIR`,
      );
      for (const match of afterPull.matchAll(/"\$RTT_SCRIPTS_DIR\/([^"]+\.mjs)"/gu)) {
        pinnedEntrypoints.add(match[1]);
      }
    });
  }

  for (const contents of workflowCache.values()) {
    for (const match of contents.matchAll(/"\$RTT_SCRIPTS_DIR\/([^"]+\.mjs)"/gu)) {
      pinnedEntrypoints.add(match[1]);
    }
  }
  assert.deepEqual([...pinnedEntrypoints].sort(), EXPECTED_ENTRYPOINTS);
});

test("archived workflow entrypoints keep their module dependency closure available", async () => {
  const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const pending = EXPECTED_ENTRYPOINTS.map((entrypoint) => path.join(SCRIPTS_ROOT, entrypoint));
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const source = await fs.readFile(current, "utf8");
    const relativePath = path.relative(REPO_ROOT, current);
    for (const specifier of moduleSpecifiers(source)) {
      if (nodeBuiltins.has(specifier)) {
        continue;
      }
      assert.ok(
        specifier.startsWith("."),
        `${relativePath} imports non-archived module ${specifier}`,
      );
      const importedPath = path.resolve(path.dirname(current), specifier);
      assert.ok(
        importedPath.startsWith(`${SCRIPTS_ROOT}${path.sep}`),
        `${relativePath} imports outside scripts/: ${specifier}`,
      );
      await fs.access(importedPath);
      pending.push(importedPath);
    }
    assert.deepEqual(
      dynamicImportExpressions(source),
      ALLOWED_DYNAMIC_IMPORTS.get(path.basename(current)) ?? [],
      `${relativePath} has an unaccounted dynamic import`,
    );
  }
});

test("commit A workflow scripts survive deletion in commit B", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rtt-pinned-scripts-"));
  t.after(() => fs.rm(tempRoot, { force: true, recursive: true }));
  const repo = path.join(tempRoot, "repo");
  const scripts = path.join(repo, "scripts");
  const archive = path.join(tempRoot, "archive");
  const archiveTar = path.join(tempRoot, "scripts.tar");
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(archive);
  await fs.writeFile(
    path.join(scripts, "helper.mjs"),
    'export const revision = "commit-a";\n',
  );
  await fs.writeFile(
    path.join(scripts, "entrypoint.mjs"),
    'import { revision } from "./helper.mjs";\nprocess.stdout.write(`${revision}\\n`);\n',
  );
  await execFileAsync("git", ["init", "--quiet"], { cwd: repo });
  await execFileAsync("git", ["config", "user.name", "RTT Test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "rtt-test@example.invalid"], {
    cwd: repo,
  });
  await execFileAsync("git", ["add", "scripts"], { cwd: repo });
  await execFileAsync("git", ["commit", "--quiet", "-m", "commit A"], { cwd: repo });
  const { stdout: commitAOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
  });
  const commitA = commitAOutput.trim();

  await execFileAsync(
    "git",
    ["archive", "--format=tar", `--output=${archiveTar}`, commitA, "scripts"],
    { cwd: repo },
  );
  await execFileAsync("tar", ["-xf", archiveTar, "-C", archive]);
  await fs.rm(scripts, { recursive: true });
  await execFileAsync("git", ["add", "--all"], { cwd: repo });
  await execFileAsync("git", ["commit", "--quiet", "-m", "commit B deletes scripts"], {
    cwd: repo,
  });

  await assert.rejects(fs.access(path.join(repo, "scripts", "entrypoint.mjs")));
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(archive, "scripts", "entrypoint.mjs"),
  ]);
  assert.equal(stdout, "commit-a\n");
});
