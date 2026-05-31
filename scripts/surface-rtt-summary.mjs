import { readSurfaceRttRows } from "./read-surface-rtt-rows.mjs";

function formatMs(value) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

function formatRss(value) {
  return typeof value === "number" ? `${Math.round(value / 1024)}MB` : "-";
}

const rows = await readSurfaceRttRows();
if (rows.length === 0) {
  process.stdout.write("No surface RTT rows yet.\n");
  process.exit(0);
}

const latest = rows.at(-1);
process.stdout.write(`Surface RTT runs: ${rows.length}\n`);
process.stdout.write(
  `Latest: ${latest.surface.id} ${latest.package.spec} ${latest.package.version} ${latest.run.status} samples=${latest.rtt.warmSamples?.length ?? 0} p50=${formatMs(latest.rtt.p50Ms)} p95=${formatMs(latest.rtt.p95Ms)}\n`,
);

for (const row of rows.slice(-10)) {
  process.stdout.write(
    [
      row.run.startedAt,
      row.surface.id,
      row.surface.scenario,
      row.package.spec,
      row.package.version,
      row.run.status,
      `samples=${row.rtt.warmSamples?.length ?? 0}`,
      `rtt_p50=${formatMs(row.rtt.p50Ms)}`,
      `rtt_p95=${formatMs(row.rtt.p95Ms)}`,
      `rss_p50=${formatRss(row.resources?.maxRssKb?.p50)}`,
      `rss_p95=${formatRss(row.resources?.maxRssKb?.p95)}`,
    ].join("  "),
  );
  process.stdout.write("\n");
}
