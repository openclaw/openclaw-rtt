# Data Imports

`openclaw-rtt` imports normalized artifacts from OpenClaw channel QA runs. The measurement harness lives in `openclaw/openclaw`; this repo stores the rows and dashboard artifacts.

## Import Commands

Run importers from the repo root:

```sh
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json --resource-metrics resource-metrics.env
node scripts/import-discord-rtt.mjs samples.tsv --spec openclaw@main --version <ref>
node scripts/import-surface-rtt.mjs samples.tsv --surface control-ui --spec openclaw@main --version <ref>
node scripts/backfill-rpc-surface-rtt.mjs
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

- `data/channels/<channel>/<version>.jsonl`: append-only graph source, one normalized run per line for that channel/version bucket.
- `runs/<channel>/<run-id>/result.json`: copied per-run record for audit/debug.
- `data/surfaces/<surface>/<version>.jsonl`: non-channel RTT surfaces such as RPC and Control UI.
- `runs/surfaces/<surface>/<run-id>/result.json`: copied per-surface record for audit/debug.

Current channel folders are `telegram`, `discord`, `slack`, and `whatsapp`. Telegram and Discord still have specialized importers because their source artifact shapes differ; they now share the same storage contract as generic live-transport channels.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied here later.

Release RSS backfills only write `resources` onto an existing Telegram or Discord row and its copied `result.json`. The backfill command asserts the stored RTT `p50` and `p95` values are unchanged before it rewrites that version's JSONL file. RSS is process-level data around the sampled command, not isolated channel transport memory.

RPC backfill rows are derived from existing channel-observed request/reply samples. They are coverage continuity rows, not pure Gateway WebSocket timings. Direct RPC or Control UI rows should be imported with explicit scenario RTT measurements or `control-ui.*` performance events.
