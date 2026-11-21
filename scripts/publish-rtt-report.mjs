import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const REPOSITORY = "openclaw/openclaw-rtt";
const BRANCH_PREFIX = "automation/rtt-reports/";
const DEADLINE = Date.now() + 5 * 60_000;
const FAMILIES = {
  telegram: ["data/channels/telegram/", "runs/telegram/"],
  discord: ["data/channels/discord/", "runs/discord/"],
  channel: ["data/channels/slack/", "data/channels/whatsapp/", "runs/slack/", "runs/whatsapp/"],
  surface: ["data/surfaces/", "runs/surfaces/"],
};

function command(program, args) {
  const remaining = DEADLINE - Date.now();
  assert(remaining > 0, "RTT publication timed out; retained reports need review");
  return execFileSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: Math.min(remaining, 120_000),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const git = (...args) =>
  command("git", ["-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args]);
const api = (...args) => JSON.parse(command("gh", ["api", ...args]));
const sha = (value) => {
  assert.match(value, /^[a-f0-9]{40}$/u, "Expected an immutable commit SHA");
  return value;
};

function currentMain() {
  return sha(api(`repos/${REPOSITORY}/git/ref/heads/main`).object.sha);
}

function holdPendingReports() {
  const refs = api(`repos/${REPOSITORY}/git/matching-refs/heads/${BRANCH_PREFIX}`);
  assert(Array.isArray(refs), "Could not enumerate retained RTT report refs");
  for (const ref of refs) {
    const branch = ref.ref.slice("refs/heads/".length);
    assert(branch.startsWith(BRANCH_PREFIX), "Unexpected report branch");
    const prs = reportPullRequests(branch);
    // Squashed heads are not ancestors of main. Only the exact PR's merged
    // receipt releases its branch; orphan and closed-unmerged refs still own data.
    assert(
      prs.some((pr) => pr.merged_at && pr.head.sha === ref.object.sha),
      `Finish retained RTT report https://github.com/${REPOSITORY}/tree/${branch} before importing more measurements`,
    );
  }
}

function reportPullRequests(branch) {
  return api(
    `repos/${REPOSITORY}/pulls?state=all&base=main&head=openclaw:${branch}&per_page=100`,
    "--paginate",
    "--slurp",
  )
    .flat()
    .filter((pr) => pr.head?.repo?.full_name === REPOSITORY && pr.head.ref === branch);
}

export function reportPaths(family) {
  assert(Object.hasOwn(FAMILIES, family), "Unknown RTT report family");
  return ["README.md", ...FAMILIES[family]];
}

export function assertOwnedPaths(changed, paths) {
  assert(
    changed.every((name) =>
      paths.some((owned) => (owned.endsWith("/") ? name.startsWith(owned) : name === owned)),
    ),
    "RTT report contains changes outside its owned paths",
  );
}

function assertPullRequest(pr, head) {
  assert.equal(pr.head?.repo?.full_name, REPOSITORY, "Unexpected PR source repository");
  assert.equal(pr.base?.repo?.full_name, REPOSITORY, "Unexpected PR destination repository");
  assert.equal(pr.base?.ref, "main", "Unexpected PR destination branch");
  assert.equal(pr.head?.sha, head, "RTT report head changed");
}

export function assertMergeReceipt(pr, submittedHead, merge) {
  assertPullRequest(pr, submittedHead);
  assert.equal(pr.merged, true, "RTT report was not merged");
  assert.equal(pr.merge_commit_sha, sha(merge), "RTT merge receipt changed");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      family: { type: "string" },
      key: { type: "string", default: "report" },
    },
  });
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY, "Unexpected report repository");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Reports publish only from main");
  const [mode] = positionals;
  if (mode === "prepare") {
    // A pending PR owns measurements not yet in main. Never replace its payload
    // with the next scheduled run's independently collected measurements.
    holdPendingReports();
    assert.equal(
      git("status", "--porcelain", "--untracked-files=all"),
      "",
      "Report checkout is dirty",
    );
    git("fetch", "--no-tags", "origin", "main");
    git("switch", "--detach", "FETCH_HEAD");
    return;
  }
  assert.equal(mode, "publish", "Use prepare or publish");
  const paths = reportPaths(values.family);
  const changed = [
    ...new Set(
      [
        ...git("diff", "HEAD", "--name-only", "-z").split("\0"),
        ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
      ].filter(Boolean),
    ),
  ];
  assertOwnedPaths(changed, paths);
  if (!changed.length) {
    console.log("No RTT changes to publish.");
    return;
  }
  holdPendingReports();
  const base = sha(git("rev-parse", "HEAD"));
  assert.equal(
    currentMain(),
    base,
    "Main advanced before RTT publication; retain the measurements and retry",
  );
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
    assert.match(process.env[name] ?? "", /^\d+$/u, `Missing ${name}`);
  }
  const suffix = createHash("sha256")
    .update(`${values.family}:${values.key}`)
    .digest("hex")
    .slice(0, 16);
  const branch = `${BRANCH_PREFIX}${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${suffix}`;
  git("diff", "--check");
  git("add", "--", ...paths);
  assert(
    !git("ls-files", "--stage", "--", ...paths)
      .split("\n")
      .some((line) => line.startsWith("120000 ")),
    "Report paths must not contain symlinks",
  );
  git(
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    `data: record ${values.family} RTT report`,
  );
  const head = sha(git("rev-parse", "HEAD"));
  const expected = git("ls-tree", "-r", head, "--", ...paths);
  // Unique run/attempt/key refs retain unsuccessful publications. A plain push
  // must fail on any conflicting existing branch; it never rewrites a report.
  git("push", "origin", `HEAD:refs/heads/${branch}`);
  console.log(
    `RTT measurements retained at https://github.com/${REPOSITORY}/tree/${branch} (${head})`,
  );
  let pr;
  try {
    pr = api(
      `repos/${REPOSITORY}/pulls`,
      "--method",
      "POST",
      "-f",
      `head=${branch}`,
      "-f",
      "base=main",
      "-f",
      `title=data: record ${values.family} RTT report`,
      "-f",
      `body=Publish validated ${values.family} measurements and their generated dashboard.\n\nOperation: ${values.key}\nWorkflow: ${process.env.GITHUB_WORKFLOW_REF}\nWorkflow revision: ${process.env.GITHUB_WORKFLOW_SHA}\nRun: https://github.com/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}\n\nPublication uses an exact-head squash merge and verifies the merged report tree.`,
    );
  } catch (error) {
    // A lost HTTP response does not prove creation failed. Recover only the
    // exact submitted branch/head, leaving uncertain outcomes held for review.
    const matches = reportPullRequests(branch).filter((candidate) => candidate.head.sha === head);
    if (matches.length !== 1) throw error;
    [pr] = matches;
  }
  console.log(`RTT report retained at ${pr.html_url}`);
  const endpoint = `repos/${REPOSITORY}/pulls/${pr.number}`;
  // GitHub computes mergeability asynchronously after creating a PR. Wait only
  // for that explicit pending state, without retrying a rejected merge.
  for (let attempt = 0; ; attempt += 1) {
    const candidate = api(endpoint);
    assertPullRequest(candidate, head);
    if (candidate.mergeable !== null) {
      assert.equal(candidate.mergeable, true, "RTT report has merge conflicts; the PR is retained");
      break;
    }
    assert(attempt < 15, "RTT mergeability is still pending; the PR is retained");
    await sleep(2_000);
  }
  assert.equal(currentMain(), base, "Main advanced before RTT merge; the report PR is retained");
  let merged;
  try {
    merged = api(
      `${endpoint}/merge`,
      "--method",
      "PUT",
      "-f",
      `sha=${head}`,
      "-f",
      "merge_method=squash",
    );
  } catch (error) {
    const receipt = api(endpoint);
    if (!receipt.merged || receipt.head?.sha !== head) throw error;
    merged = { merged: true, sha: receipt.merge_commit_sha };
  }
  assert.equal(merged.merged, true, "RTT report merge was refused; the PR is retained");
  const merge = sha(merged.sha);
  assertMergeReceipt(api(endpoint), head, merge);
  git("fetch", "--no-tags", "origin", "main");
  git("merge-base", "--is-ancestor", merge, "FETCH_HEAD");
  assert.equal(
    git("ls-tree", "-r", merge, "--", ...paths),
    expected,
    "Merged RTT report tree differs from the validated publication",
  );
  // Squash changes commit identity. The receipt is the merged tree and merge
  // commit reachable from main, never ancestry of the submitted branch head.
  git("switch", "--detach", "FETCH_HEAD");
  console.log(`Published RTT report ${pr.html_url} at ${merge}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      error.status === undefined
        ? error.message
        : "RTT publication command failed; retain its report branch and inspect the workflow.",
    );
    console.error("[publish-rtt-report] FAILED (exit 1)");
    process.exitCode = 1;
  });
}
