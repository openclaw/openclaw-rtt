# OpenClaw RTT

Time-series store for OpenClaw Telegram RTT measurements.

The measurement harness lives in `openclaw/openclaw`. This repo stores normalized results and later graph/dashboard code.

## Import A Run

From this repo:

```sh
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json
node scripts/summary.mjs
```

Expected source shape is the `result.json` emitted by:

```sh
pnpm rtt openclaw@beta
pnpm rtt openclaw@beta --samples 20
pnpm rtt openclaw@latest
pnpm rtt openclaw@2026.4.30 --provider live-frontier
```

## Data

- `data/rtt.jsonl`: append-only graph source, one normalized run per line.
- `runs/<run-id>/result.json`: copied per-run result record for audit/debug.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied in later.

## Latest Main

<!-- latest-main:start -->

| Ref | Result | Samples | Canary RTT | Avg | p50 | p95 | Max | Failed attempts | Started |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `2026.4.30+d87e6ee2ae` | Pass | 20 | `1,433ms` | `6,202ms` | `3,510ms` | `15,739ms` | `23,653ms` | 6 | `2026-05-02T01:08:31.751Z` |

<!-- latest-main:end -->

## Latest Stable Sweep

Measured on 2026-05-01 with the OpenClaw repo black-box harness on `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, 240s canary timeout, and 30s per-sample timeout.

The SUT is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-01 normal-reply sweep](logs/2026-05-01-normal-reply.md).

| npm version | Result | Samples | Canary RTT | Avg | p50 | p95 | Max | Failed attempts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `2026.4.15` | Pass | 20 | `46,712ms` | `7,372ms` | `4,652ms` | `16,338ms` | `29,685ms` | 3 |
| `2026.4.20` | Pass | 20 | `20,746ms` | `7,243ms` | `4,231ms` | `20,805ms` | `26,215ms` | 3 |
| `2026.4.21` | Pass | 20 | `47,681ms` | `7,884ms` | `4,303ms` | `23,807ms` | `26,852ms` | 3 |
| `2026.4.22` | Pass | 20 | `120,672ms` | `5,628ms` | `3,266ms` | `16,684ms` | `27,156ms` | 2 |
| `2026.4.23` | Fail | 0 | - | - | - | - | - | 20 |
| `2026.4.24` | Pass | 20 | `65,359ms` | `11,980ms` | `8,286ms` | `24,771ms` | `27,054ms` | 2 |
| `2026.4.25` | Fail | 0 | `159,784ms` | - | - | - | - | 20 |
| `2026.4.26` | Pass | 20 | `159,823ms` | `25,875ms` | `25,305ms` | `27,784ms` | `33,689ms` | 15 |
| `2026.4.27` | Pass | 20 | `9,362ms` | `18,210ms` | `15,458ms` | `29,035ms` | `30,580ms` | 0 |
| `2026.4.29` | Fail | 0 | `9,704ms` | - | - | - | - | 20 |
