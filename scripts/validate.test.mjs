import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATE_SCRIPT = path.join(REPO_ROOT, "scripts/validate.mjs");

test("rejects channel-derived rows in the RPC metric", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rtt-validate-test-"));
  const dataPath = path.join(workspace, "data/surfaces/rpc/2026.7.2-beta.5.jsonl");
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(
    dataPath,
    `${JSON.stringify({
      surface: { id: "rpc", label: "RPC", scenario: "channel-rtt-backfill" },
      package: { spec: "openclaw@2026.7.2-beta.5", version: "2026.7.2-beta.5" },
      run: {
        id: "rpc-channel-rtt-backfill-2026.7.2-beta.5",
        startedAt: "2026-09-03T00:00:00.000Z",
        status: "pass",
      },
      mode: { source: "channel-rtt-backfill" },
      rtt: { warmSamples: [0, 0, 9209], p50Ms: 0, p95Ms: 9209 },
    })}\n`,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [VALIDATE_SCRIPT], { cwd: workspace }),
    /RPC rows must use native Gateway measurements/u,
  );
});
