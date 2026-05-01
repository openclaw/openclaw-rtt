import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.resolve("data/rtt.jsonl");

function assertRun(row, index) {
  if (typeof row !== "object" || row === null) {
    throw new Error(`row ${index} must be an object`);
  }
  if (typeof row.package?.spec !== "string") {
    throw new Error(`row ${index} missing package.spec`);
  }
  if (typeof row.package?.version !== "string") {
    throw new Error(`row ${index} missing package.version`);
  }
  if (typeof row.run?.id !== "string") {
    throw new Error(`row ${index} missing run.id`);
  }
  if (row.run.status !== "pass" && row.run.status !== "fail") {
    throw new Error(`row ${index} has invalid run.status`);
  }
}

async function main() {
  let text = "";
  try {
    text = await fs.readFile(DATA_PATH, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stdout.write("ok: no data/rtt.jsonl yet\n");
      return;
    }
    throw error;
  }

  const seen = new Set();
  const lines = text.split("\n").filter(Boolean);
  lines.forEach((line, index) => {
    const row = JSON.parse(line);
    assertRun(row, index + 1);
    if (seen.has(row.run.id)) {
      throw new Error(`duplicate run id: ${row.run.id}`);
    }
    seen.add(row.run.id);
  });
  process.stdout.write(`ok: ${lines.length} rows\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
