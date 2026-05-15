import { readDiscordRttRows } from "./read-discord-rtt-rows.mjs";

function formatMs(value) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

const rows = await readDiscordRttRows();
if (rows.length === 0) {
  process.stdout.write("No Discord RTT rows yet.\n");
  process.exit(0);
}

const latest = rows.at(-1);
process.stdout.write(`Discord RTT runs: ${rows.length}\n`);
process.stdout.write(
  `Latest: ${latest.package.spec} ${latest.package.version} ${latest.run.status} samples=${latest.rtt.warmSamples?.length ?? 0} p50=${formatMs(latest.rtt.p50Ms)} p95=${formatMs(latest.rtt.p95Ms)}\n`,
);

for (const row of rows.slice(-10)) {
  process.stdout.write(
    [
      row.run.startedAt,
      row.package.spec,
      row.package.version,
      row.run.status,
      `samples=${row.rtt.warmSamples?.length ?? 0}`,
      `p50=${formatMs(row.rtt.p50Ms)}`,
      `p95=${formatMs(row.rtt.p95Ms)}`,
    ].join("  "),
  );
  process.stdout.write("\n");
}
