import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("reads each legacy and versioned channel row once in chronological order", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rtt-channel-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data/channels");
  await fs.mkdir(path.join(data, "telegram"), { recursive: true });
  await fs.mkdir(path.join(data, "slack"), { recursive: true });
  for (const [file, id, day] of [
    ["telegram.jsonl", "legacy-telegram", "02"],
    ["telegram/2026.9.1.jsonl", "versioned-telegram", "03"],
    ["discord.jsonl", "legacy-only", "01"],
    ["slack/2026.9.1.jsonl", "versioned-only", "04"],
  ]) {
    const row = { run: { id, startedAt: `2026-09-${day}T00:00:00.000Z` } };
    await fs.writeFile(path.join(data, file), `${JSON.stringify(row)}\n`);
  }
  await fs.writeFile(path.join(data, "README.md"), "not a channel");
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module", "--eval",
    `import { readAllChannelRows } from ${JSON.stringify(new URL("./channel-storage.mjs", import.meta.url).href)};
     console.log(JSON.stringify((await readAllChannelRows()).map((row) => row.run.id)));`,
  ], { cwd: root });
  assert.deepEqual(JSON.parse(stdout), [
    "legacy-only", "legacy-telegram", "versioned-telegram", "versioned-only",
  ]);
});
