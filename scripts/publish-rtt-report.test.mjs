import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertOwnedPaths, reportPaths } from "./publish-rtt-report.mjs";

const SCRIPT = fileURLToPath(new URL("./publish-rtt-report.mjs", import.meta.url));
const FAKE_GH = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE, 'utf8'));
const args = process.argv.slice(3);
const endpoint = args[0];
const field = name => args.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const git = (...values) => execFileSync('git', ['--git-dir', process.env.FIXTURE_REMOTE, ...values], {encoding:'utf8', env:process.env}).trim();
const main = () => git('rev-parse', 'refs/heads/main');
const save = () => fs.writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state));
let response;
if (endpoint.includes('/git/matching-refs/')) {
  response = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/automation/rtt-reports/').split('\n').filter(Boolean).map(line => {
    const [ref, sha] = line.split(' '); return {ref, object:{sha}};
  });
} else if (endpoint.includes('/git/ref/')) {
  state.guards = (state.guards || 0) + 1;
  if (state.scenario === 'base-race' && state.guards === 2) {
    const old = main();
    const next = git('commit-tree', old + '^{tree}', '-p', old, '-m', 'concurrent update');
    git('update-ref', 'refs/heads/main', next);
  }
  response = {object:{sha:main()}};
} else if (endpoint.includes('?state=')) {
  const branch = endpoint.split('&head=openclaw:')[1].split('&')[0];
  const mergedHead = state.mergedHeads?.[branch];
  response = [[...(mergedHead ? [{head:{ref:branch, sha:mergedHead, repo:{full_name:'openclaw/openclaw-rtt'}}, merged_at:'2026-01-01T00:00:00Z'}] : state.pr ? [state.pr] : [])]];
} else if (endpoint.endsWith('/merge')) {
  if (field('sha') !== state.pr.head.sha || field('merge_method') !== 'squash') throw Error('unbound merge');
  if (state.scenario === 'refused') response = {merged:false};
  else {
    const tree = state.scenario === 'wrong-tree' ? main() : state.pr.head.sha;
    const merge = git('commit-tree', tree + '^{tree}', '-p', main(), '-m', 'squashed report');
    git('update-ref', 'refs/heads/main', merge);
    state.pr.merged = true;
    state.pr.merged_at = '2026-01-01T00:00:00Z';
    state.pr.merge_commit_sha = merge;
    response = {merged:true, sha:merge};
    if (state.scenario === 'merge-response-lost') { save(); process.exit(1); }
  }
} else if (args.includes('POST')) {
  if (state.scenario === 'create-failed') process.exit(1);
  const repository = {full_name:'openclaw/openclaw-rtt'};
  state.pr = {number:1, html_url:'https://github.com/openclaw/openclaw-rtt/pull/1',
    head:{ref:field('head'), sha:git('rev-parse', 'refs/heads/' + field('head')), repo:repository},
    base:{ref:'main', sha:main(), repo:repository}, state:'open', merged:false, mergeable:true};
  response = state.pr;
  if (state.scenario === 'create-response-lost') { save(); process.exit(1); }
} else {
  response = structuredClone(state.pr);
  if (state.scenario === 'pending-mergeability' && !state.read) { response.mergeable = null; state.read = true; }
  if (state.scenario === 'head-drift') response.head.sha = 'f'.repeat(40);
  if (state.scenario === 'false-receipt' && response.merged) response.merged = false;
}
save();
process.stdout.write(JSON.stringify(response));
`;

async function fixture(t, scenario = "success") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rtt-pr-publisher-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "checkout");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  const state = path.join(root, "state.json");
  await fs.mkdir(checkout);
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  await fs.writeFile(state, JSON.stringify({ scenario }));
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    FIXTURE_STATE: state,
    FIXTURE_REMOTE: remote,
    // CI's relative cache path would create untracked files inside the Git
    // fixture. Keep caching enabled under the fixture's disposable outer root.
    NODE_COMPILE_CACHE: path.join(root, "node-compile-cache"),
    GITHUB_REPOSITORY: "openclaw/openclaw-rtt",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "openclaw/openclaw-rtt/.github/workflows/main-rtt.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (...args) =>
    execFileSync("git", ["-C", checkout, "-c", "commit.gpgsign=false", ...args], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  execFileSync("git", ["init", "--bare", "--quiet", remote], { env });
  git("init", "--quiet", "--initial-branch=main");
  git("remote", "add", "origin", remote);
  await fs.writeFile(path.join(checkout, "README.md"), "original dashboard\n");
  await fs.mkdir(path.join(checkout, "data/channels/telegram"), { recursive: true });
  await fs.mkdir(path.join(checkout, "runs/telegram/old"), { recursive: true });
  await fs.writeFile(path.join(checkout, "data/channels/telegram/v1.jsonl"), '{"id":"old"}\n');
  await fs.writeFile(path.join(checkout, "runs/telegram/old/result.json"), '{"id":"old"}\n');
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  git("push", "--quiet", "origin", "main");
  const base = git("rev-parse", "HEAD");
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: checkout, env, encoding: "utf8" });
  const runOk = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.signal);
    return result;
  };
  const addReport = async () => {
    await fs.appendFile(path.join(checkout, "data/channels/telegram/v1.jsonl"), '{"id":"new"}\n');
    await fs.mkdir(path.join(checkout, "runs/telegram/new"));
    await fs.writeFile(path.join(checkout, "runs/telegram/new/result.json"), '{"id":"new"}\n');
    await fs.writeFile(path.join(checkout, "README.md"), "updated dashboard\n");
  };
  return { root, checkout, state, git, base, run, runOk, addReport };
}

test("report families reject unrelated files before publication", () => {
  for (const family of ["telegram", "discord", "channel", "surface"]) {
    const paths = reportPaths(family);
    assertOwnedPaths(["README.md", `${paths[1]}v1.jsonl`], paths);
    assert.throws(() => assertOwnedPaths(["scripts/validate.mjs"], paths), /owned paths/u);
    assert.throws(() => assertOwnedPaths(["README.md.bak"], paths), /owned paths/u);
  }
  assert.throws(() => reportPaths("unknown"), /Unknown/u);
});

test("normal squash publishes the complete report and verifies the real merged tree", async (t) => {
  const f = await fixture(t);
  f.runOk("prepare");
  assert((await fs.stat(path.join(f.root, "node-compile-cache"))).isDirectory());
  assert.equal(f.git("status", "--porcelain", "--untracked-files=all"), "");
  await f.addReport();
  const run = f.run("publish", "--family", "telegram");
  assert.equal(run.status, 0, run.stderr);
  const { pr } = JSON.parse(await fs.readFile(f.state, "utf8"));
  assert.equal(pr.merged, true);
  assert.match(run.stdout, /Published RTT report/u);
  assert.notEqual(pr.head.sha, pr.merge_commit_sha);
  assert.equal(f.git("rev-parse", "HEAD"), pr.merge_commit_sha);
  assert.equal(f.git("show", `${pr.merge_commit_sha}:README.md`), "updated dashboard");
  assert.match(
    f.git("show", `${pr.merge_commit_sha}:data/channels/telegram/v1.jsonl`),
    /old[\s\S]*new/u,
  );
  assert.equal(
    f.git("show", `${pr.merge_commit_sha}:runs/telegram/new/result.json`),
    '{"id":"new"}',
  );
  assert.throws(() => f.git("merge-base", "--is-ancestor", pr.head.sha, pr.merge_commit_sha));
});

test("verified merged report branches do not cap future imports", async (t) => {
  const f = await fixture(t);
  const branches = Array.from({ length: 101 }, (_, index) => `automation/rtt-reports/old-${index}`);
  const state = JSON.parse(await fs.readFile(f.state, "utf8"));
  state.mergedHeads = Object.fromEntries(branches.map((branch) => [branch, f.base]));
  await fs.writeFile(f.state, JSON.stringify(state));
  f.git("push", "--quiet", "origin", ...branches.map((branch) => `${f.base}:refs/heads/${branch}`));
  const run = f.run("prepare");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(f.git("rev-parse", "HEAD"), f.base);
});

for (const scenario of ["base-race", "head-drift", "refused", "false-receipt", "wrong-tree"]) {
  test(`${scenario} never reports a verified publication`, async (t) => {
    const f = await fixture(t, scenario);
    f.runOk("prepare");
    await f.addReport();
    const run = f.run("publish", "--family", "telegram");
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /Published RTT report/u);
    assert.match(run.stderr, /\[publish-rtt-report\] FAILED/u);
    const { pr } = JSON.parse(await fs.readFile(f.state, "utf8"));
    assert.match(f.git("show", `${pr.head.sha}:data/channels/telegram/v1.jsonl`), /new/u);
  });
}

test("a failed merge retains its payload and holds later imports", async (t) => {
  const f = await fixture(t, "refused");
  f.runOk("prepare");
  await f.addReport();
  assert.notEqual(f.run("publish", "--family", "telegram").status, 0);
  const before = JSON.parse(await fs.readFile(f.state, "utf8")).pr;
  const run = f.run("prepare");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Finish retained RTT report/u);
  const after = JSON.parse(await fs.readFile(f.state, "utf8")).pr;
  assert.deepEqual(after, before);
  assert.equal(f.git("rev-parse", `refs/remotes/origin/${before.head.ref}`), before.head.sha);
});

test("RSS iterations retain each earlier merged version and use distinct immutable branches", async (t) => {
  const f = await fixture(t);
  f.runOk("prepare");
  await f.addReport();
  f.runOk("publish", "--family", "telegram", "--key", "v1");
  const first = JSON.parse(await fs.readFile(f.state, "utf8")).pr;
  f.runOk("prepare");
  await fs.writeFile(path.join(f.checkout, "README.md"), "second version dashboard\n");
  f.runOk("publish", "--family", "telegram", "--key", "v2");
  const second = JSON.parse(await fs.readFile(f.state, "utf8")).pr;
  assert.notEqual(first.head.ref, second.head.ref);
  assert.match(
    f.git("show", `${second.merge_commit_sha}:data/channels/telegram/v1.jsonl`),
    /old[\s\S]*new/u,
  );
  assert.doesNotThrow(() =>
    f.git("merge-base", "--is-ancestor", first.merge_commit_sha, second.merge_commit_sha),
  );
});

for (const scenario of ["create-response-lost", "merge-response-lost", "pending-mergeability"]) {
  test(`${scenario} is reconciled by exact remote identity`, async (t) => {
    const f = await fixture(t, scenario);
    f.runOk("prepare");
    await f.addReport();
    const run = f.run("publish", "--family", "telegram");
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Published RTT report/u);
    assert.equal(JSON.parse(await fs.readFile(f.state, "utf8")).pr.merged, true);
  });
}

test("an orphan branch remains discoverable and holds later imports", async (t) => {
  const f = await fixture(t, "create-failed");
  f.runOk("prepare");
  await f.addReport();
  const publish = f.run("publish", "--family", "telegram");
  assert.notEqual(publish.status, 0);
  assert.match(
    publish.stdout,
    /RTT measurements retained at https:\/\/github.com\/openclaw\/openclaw-rtt\/tree\/automation\/rtt-reports\//u,
  );
  assert.notEqual(f.run("prepare").status, 0);
  assert.match(f.run("prepare").stderr, /Finish retained RTT report/u);
});

test("closing an unmerged report does not discard its held payload", async (t) => {
  const f = await fixture(t, "refused");
  f.runOk("prepare");
  await f.addReport();
  assert.notEqual(f.run("publish", "--family", "telegram").status, 0);
  const state = JSON.parse(await fs.readFile(f.state, "utf8"));
  state.pr.state = "closed";
  await fs.writeFile(f.state, JSON.stringify(state));
  const run = f.run("prepare");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Finish retained RTT report/u);
});
