# Data Imports

`openclaw-rtt` imports normalized artifacts from OpenClaw channel QA runs. The measurement harness lives in `openclaw/openclaw`; this repo stores the rows and dashboard artifacts.

## Import Commands

Run importers from the repo root:

```sh
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json --resource-metrics resource-metrics.env
node scripts/import-discord-rtt.mjs samples.tsv --spec openclaw@main --version <ref>
node scripts/backfill-release-rss.mjs --family discord --spec openclaw@2026.5.16 --version 2026.5.16 --sample-paths samples.tsv
node scripts/summary.mjs
```

Telegram release imports expect the `result.json` shape emitted by:

```sh
pnpm rtt openclaw@beta
pnpm rtt openclaw@beta --samples 20
pnpm rtt openclaw@latest
pnpm rtt openclaw@2026.4.30 --provider live-frontier
```

## Data Layout

- `data/rtt.jsonl`: append-only Telegram graph source, one normalized run per line.
- `runs/<run-id>/result.json`: copied Telegram run record for audit/debug.
- `data/discord-rtt.jsonl`: append-only Discord RTT graph source.
- `discord-runs/<run-id>/result.json`: copied Discord run record.
- `data/channel-rtt/<channel>.jsonl`: append-only graph source for generic live-transport channel RTT runs.
- `channel-runs/<channel>/<run-id>/result.json`: copied generic channel run record.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied here later.

Release RSS backfills only write `resources` onto an existing Telegram or Discord row and its copied `result.json`. The backfill command asserts the stored RTT `p50` and `p95` values are unchanged before it writes the JSONL file.
