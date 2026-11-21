import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const IMPORTS = [
  ["main-rtt.yml", "Import result", "Commit result", "telegram", true],
  ["main-discord-rtt.yml", "Import Discord RTT result", "Commit result", "discord", true],
  ["main-channel-rtt.yml", "Import channel RTT results", "Commit result", "channel", true],
  [
    "main-surface-rtt.yml",
    "Validate imported Surface RTT",
    "Commit imported Surface RTT",
    "surface",
    true,
  ],
  ["stable-release-rtt.yml", "Run RSS backfill", "Run RSS backfill", "telegram", false],
  ["stable-release-rtt.yml", "Import result", "Commit result", "telegram", false],
  [
    "stable-release-discord-rtt.yml",
    "Import Discord release RTT results",
    "Commit result",
    "discord",
    false,
  ],
  [
    "release-channel-rtt.yml",
    "Import channel release RTT results",
    "Commit result",
    "channel",
    false,
  ],
  [
    "release-surface-rtt.yml",
    "Import surface release RTT results",
    "Commit result",
    "surface",
    false,
  ],
];

function step(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end < 0 ? undefined : end);
}

test("all nine import paths validate their dashboard before the shared PR publisher", async (t) => {
  assert.equal(IMPORTS.length, 9);
  for (const [file, importName, publishName, family, main] of IMPORTS) {
    await t.test(`${file}: ${importName}`, async () => {
      const workflow = await fs.readFile(
        new URL(`../.github/workflows/${file}`, import.meta.url),
        "utf8",
      );
      const generation = `node "$RTT_SCRIPTS_DIR/update-readme.mjs"${main ? " --latest-main-only" : ""}`;
      const imported = step(workflow, importName);
      const published = step(workflow, publishName);
      assert(imported.includes(generation));
      assert(
        imported.indexOf(generation) < imported.indexOf('node "$RTT_SCRIPTS_DIR/validate.mjs"'),
      );
      assert(
        published.includes(
          `node "$RTT_SCRIPTS_DIR/publish-rtt-report.mjs" publish --family ${family}`,
        ),
      );
      assert.doesNotMatch(workflow, /\bgit (?:push|commit|pull)\b/u);
    });
  }
});

test("every ordinary publisher admits only the default branch and holds one noncancelling queue", async () => {
  for (const file of new Set(IMPORTS.map(([file]) => file))) {
    const workflow = await fs.readFile(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    const report = workflow.split("\n  report:\n")[1];
    assert.match(report, /if: github\.ref == 'refs\/heads\/main'/u);
    assert.match(
      report,
      /group: rtt-report-writer-main\n      cancel-in-progress: false\n      queue: max/u,
    );
    assert.match(report, /pull-requests: write/u);
    assert.match(report, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
    assert.match(report, /publish-rtt-report\.mjs" prepare/u);
  }
});
