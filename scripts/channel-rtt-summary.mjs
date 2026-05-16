import { readChannelRttRows } from "./read-channel-rtt-rows.mjs";

function formatMs(value) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

function formatRss(value) {
  return typeof value === "number" ? `${Math.round(value / 1024)}MB` : "-";
}

const rows = await readChannelRttRows();
if (rows.length === 0) {
  process.stdout.write("No channel RTT rows yet.\n");
  process.exit(0);
}

const latest = rows.at(-1);
process.stdout.write(`Channel RTT runs: ${rows.length}\n`);
process.stdout.write(
  `Latest: ${latest.channel.id} ${latest.package.spec} ${latest.package.version} ${latest.run.status} samples=${latest.rtt.warmSamples?.length ?? 0} p50=${formatMs(latest.rtt.p50Ms)} p95=${formatMs(latest.rtt.p95Ms)}\n`,
);

for (const row of rows.slice(-10)) {
  process.stdout.write(
    [
      row.run.startedAt,
      row.channel.id,
      row.channel.scenario,
      row.package.spec,
      row.package.version,
      row.run.status,
      `samples=${row.rtt.warmSamples?.length ?? 0}`,
      `retries=${row.polling?.retryCount ?? 0}`,
      `rtt_p50=${formatMs(row.rtt.p50Ms)}`,
      `rtt_p95=${formatMs(row.rtt.p95Ms)}`,
      `rss_p50=${formatRss(row.resources?.maxRssKb?.p50)}`,
      `rss_p95=${formatRss(row.resources?.maxRssKb?.p95)}`,
    ].join("  "),
  );
  process.stdout.write("\n");
}
