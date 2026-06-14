# Data Imports

`openclaw-rtt` imports normalized artifacts from OpenClaw channel QA runs. The measurement harness lives in `openclaw/openclaw`; this repo stores the rows and dashboard artifacts.

## Import Commands

Run importers from the repo root:

```sh
node scripts/import-result.mjs ../openclaw/.artifacts/qa-e2e/npm-telegram-live/<run>/qa-evidence.json --spec openclaw@beta --version <version> --started-at <iso> --finished-at <iso>
node scripts/import-result.mjs ../openclaw/.artifacts/qa-e2e/npm-telegram-live/<run>/qa-evidence.json --spec openclaw@beta --version <version> --started-at <iso> --finished-at <iso> --resource-metrics resource-metrics.env
node scripts/import-discord-rtt.mjs samples.tsv --spec openclaw@main --version <ref>
(cd ../openclaw && node --import tsx ../openclaw-rtt/scripts/measure-rpc-rtt.mjs --output-dir ../openclaw-rtt/.artifacts/rpc-rtt/sample-1)
node scripts/import-surface-rtt.mjs rpc-samples.tsv --surface rpc --spec openclaw@main --version <ref> --provider-mode gateway-rpc --scenario rpc-gateway-smoke --require-pass
node scripts/import-surface-rtt.mjs samples.tsv --surface control-ui --spec openclaw@main --version <ref>
node scripts/backfill-rpc-surface-rtt.mjs
node scripts/backfill-release-rss.mjs --family discord --spec openclaw@2026.5.16 --version 2026.5.16 --sample-paths samples.tsv
node scripts/summary.mjs
```

Telegram release imports expect the aggregate `qa-evidence.json` shape emitted by the OpenClaw package Telegram live lane. The OpenClaw harness checkout must include the package Telegram RTT evidence path; older OpenClaw packages can still be the system under test.

```sh
OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC=openclaw@beta \
OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES=20 \
pnpm test:docker:npm-telegram-live
```

## Data Layout

- `data/channels/<channel>/<version>.jsonl`: append-only graph source, one normalized run per line for that channel/version bucket.
- `runs/<channel>/<run-id>/result.json`: copied per-run record for audit/debug.
- `data/surfaces/<surface>/<version>.jsonl`: non-channel RTT surfaces such as RPC and Control UI.
- `runs/surfaces/<surface>/<run-id>/result.json`: copied per-surface record for audit/debug.

Current channel folders are `telegram`, `discord`, `slack`, and `whatsapp`. Telegram and Discord still have specialized importers because their source artifact shapes differ; they now share the same storage contract as generic live-transport channels.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied here later. Historical Telegram rows imported from the old package RTT wrapper may include `rtt.warmSamples` with every successful sample value. New Telegram imports from `qa-evidence.json` preserve the aggregate dashboard metrics (`canaryMs`, `mentionReplyMs`, `avgMs`, `p50Ms`, `p95Ms`, `maxMs`, `sampleCount`, and `failedSamples`) but do not reconstruct individual sample RTT arrays because the evidence artifact stores aggregate timing.

Release RSS backfills only write `resources` onto an existing Telegram or Discord row and its copied `result.json`. The backfill command asserts the stored RTT `p50` and `p95` values are unchanged before it rewrites that version's JSONL file. RSS is process-level data around the sampled command, not isolated channel transport memory.

Native RPC rows come from `scripts/measure-rpc-rtt.mjs`, which starts an isolated loopback Gateway, warms each method once, and measures persistent WebSocket calls such as `health` and `config.get`. RPC backfill rows are derived from existing channel-observed request/reply samples; they are coverage continuity rows, not pure Gateway WebSocket timings. Control UI rows should be imported with explicit scenario RTT measurements or `control-ui.*` performance events.
