import fs from "node:fs/promises";
import { readRows } from "./read-rows.mjs";

const README_PATH = "README.md";
const START = "<!-- latest-main:start -->";
const END = "<!-- latest-main:end -->";

function formatMs(value) {
  return typeof value === "number" ? `\`${Math.round(value).toLocaleString("en-US")}ms\`` : "-";
}

function tableFor(row) {
  if (!row) {
    return [
      START,
      "",
      "No `openclaw@main` RTT run has been imported yet.",
      "",
      END,
    ].join("\n");
  }
  return [
    START,
    "",
    "| Ref | Result | Samples | Canary RTT | Avg | p50 | p95 | Max | Failed attempts | Started |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| \`${row.package.version}\` | ${row.run.status === "pass" ? "Pass" : "Fail"} | ${row.rtt.warmSamples?.length ?? 0} | ${formatMs(row.rtt.canaryMs)} | ${formatMs(row.rtt.avgMs)} | ${formatMs(row.rtt.p50Ms)} | ${formatMs(row.rtt.p95Ms)} | ${formatMs(row.rtt.maxMs)} | ${row.rtt.failedSamples ?? 0} | \`${row.run.startedAt}\` |`,
    "",
    END,
  ].join("\n");
}

async function main() {
  const rows = await readRows();
  const latestMain = rows.filter((row) => row.package.spec === "openclaw@main").at(-1);
  const replacement = tableFor(latestMain);
  const readme = await fs.readFile(README_PATH, "utf8");
  const startIndex = readme.indexOf(START);
  const endIndex = readme.indexOf(END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md must contain ${START} and ${END} markers.`);
  }
  const next = `${readme.slice(0, startIndex)}${replacement}${readme.slice(endIndex + END.length)}`;
  await fs.writeFile(README_PATH, next);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
