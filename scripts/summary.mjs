import { readRows } from "./read-rows.mjs";

function formatMs(value) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

const rows = await readRows();
if (rows.length === 0) {
  process.stdout.write("No RTT rows yet.\n");
  process.exit(0);
}

const latest = rows.at(-1);
process.stdout.write(`Runs: ${rows.length}\n`);
process.stdout.write(
  `Latest: ${latest.package.spec} ${latest.package.version} ${latest.run.status} canary=${formatMs(
    latest.rtt.canaryMs,
  )} mention=${formatMs(latest.rtt.mentionReplyMs)} p50=${formatMs(
    latest.rtt.p50Ms,
  )} p95=${formatMs(latest.rtt.p95Ms)}\n`,
);

for (const row of rows.slice(-10)) {
  process.stdout.write(
    [
      row.run.startedAt,
      row.package.spec,
      row.package.version,
      row.run.status,
      `canary=${formatMs(row.rtt.canaryMs)}`,
      `mention=${formatMs(row.rtt.mentionReplyMs)}`,
      `p50=${formatMs(row.rtt.p50Ms)}`,
      `p95=${formatMs(row.rtt.p95Ms)}`,
    ].join("  "),
  );
  process.stdout.write("\n");
}
