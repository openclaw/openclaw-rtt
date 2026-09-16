import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "2026.5.16";
const RUN = {
  id: "tsv-test",
  startedAt: "2026-05-16T00:00:00.000Z",
  finishedAt: "2026-05-16T00:00:02.000Z",
  durationMs: 2000,
  status: "pass",
};

async function makeWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-tsv-test-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}

async function readRow(workspace, family, target) {
  return JSON.parse((await fs.readFile(
    path.join(workspace, "data", family, target, `${VERSION}.jsonl`), "utf8",
  )).trim());
}

const importers = [
  { script: "import-discord-rtt.mjs", family: "channels", target: "discord", scenario: "discord-canary", args: [] },
  { script: "import-live-transport-rtt.mjs", family: "channels", target: "slack", scenario: "slack-canary", args: ["--channel", "slack"] },
  { script: "import-surface-rtt.mjs", family: "surfaces", target: "control-ui", scenario: "control-ui-qa-channel-image-roundtrip", args: ["--surface", "control-ui"] },
];

for (const [endingName, ending] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  for (const importer of importers) {
    for (const fullColumns of [false, true]) {
      test(`${importer.script} reads ${endingName} TSV with ${fullColumns ? "all columns" : "one column"}`, async (t) => {
        const workspace = await makeWorkspace(t);
        // Spaces are part of the filenames, not whitespace to trim from TSV fields.
        const summaryPath = " summary.json ";
        const metricsPath = " metrics.env ";
        const sidecarPath = " sidecar.json ";
        const usesEvents = importer.family === "surfaces" && fullColumns;
        await fs.writeFile(path.join(workspace, summaryPath), JSON.stringify({
          ...RUN,
          counts: { total: 1, passed: 1, failed: 0 },
          scenarios: [{
            id: importer.scenario,
            status: "pass",
            ...(usesEvents ? {} : { rttMeasurement: {
              finalMatchedReplyRttMs: 25,
              requestStartedAt: RUN.startedAt,
              responseObservedAt: RUN.finishedAt,
              source: "scenario-rtt",
            } }),
          }],
        }));
        await fs.writeFile(path.join(workspace, metricsPath), "max_rss_kb=204800\nelapsed_seconds=2\n");
        await fs.writeFile(path.join(workspace, sidecarPath), JSON.stringify(usesEvents
          ? [{ event: "control-ui.rpc", payload: { method: "chat.send", ok: true, durationMs: 25 } }]
          : []));
        const fields = fullColumns
          ? importer.family === "surfaces"
            ? [summaryPath, metricsPath, sidecarPath]
            : [summaryPath, sidecarPath, metricsPath]
          : [summaryPath];
        await fs.writeFile(path.join(workspace, "samples.tsv"), `${fields.join("\t")}${ending}${ending}`);

        await execFileAsync(process.execPath, [
          path.join(SCRIPT_DIR, importer.script), "samples.tsv", ...importer.args,
          "--spec", `openclaw@${VERSION}`, "--version", VERSION, "--require-pass",
        ], { cwd: workspace });
        const row = await readRow(workspace, importer.family, importer.target);
        assert.equal(row.run.status, "pass");
        assert.deepEqual(row.rtt.warmSamples, [25]);
        if (fullColumns) {
          assert.deepEqual(row.resources.maxRssKbSamples, [204800]);
        }
      });
    }
  }

  test(`RSS backfill reads ${endingName} sample paths without changing RTT`, async (t) => {
    const workspace = await makeWorkspace(t);
    const resultPath = path.join(workspace, "runs/discord", RUN.id, "result.json");
    const dataPath = path.join(workspace, "data/channels/discord", `${VERSION}.jsonl`);
    const row = {
      package: { spec: `openclaw@${VERSION}`, version: VERSION },
      run: RUN,
      rtt: { warmSamples: [25], p50Ms: 25, p95Ms: 25, failedSamples: 0 },
      artifacts: { resultPath: `runs/discord/${RUN.id}/result.json` },
    };
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(resultPath, JSON.stringify(row));
    await fs.writeFile(dataPath, `${JSON.stringify(row)}\n`);
    await fs.writeFile(path.join(workspace, " metrics.env "), "max_rss_kb=204800\nelapsed_seconds=2\n");
    await fs.writeFile(path.join(workspace, "samples.tsv"), `summary.json\t\t metrics.env ${ending}${ending}`);
    await execFileAsync(process.execPath, [
      path.join(SCRIPT_DIR, "backfill-release-rss.mjs"), "--family", "discord",
      "--spec", `openclaw@${VERSION}`, "--version", VERSION, "--sample-paths", "samples.tsv",
    ], { cwd: workspace });
    const updated = await readRow(workspace, "channels", "discord");
    assert.deepEqual(updated.rtt, row.rtt);
    assert.deepEqual(updated.resources.maxRssKbSamples, [204800]);
    assert.deepEqual(JSON.parse(await fs.readFile(resultPath, "utf8")), updated);
  });
}
