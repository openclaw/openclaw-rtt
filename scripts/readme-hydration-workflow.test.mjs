import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/readme-hydration.yml");

test("README hydration runs when the shared OpenClaw version contract changes", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  assert.match(workflow, /- "scripts\/openclaw-version\.mjs"/u);
});
