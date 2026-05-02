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

| Ref | Result | Samples | p50 | p95 | Started |
|---|---:|---:|---:|---:|---:|
| `2026.4.30+d87e6ee2ae` | Pass | 20 | `3,510ms` | `15,739ms` | `2026-05-02T01:08:31.751Z` |

<!-- latest-main:end -->

## Latest Stable Sweep

Measured on 2026-05-01 with the OpenClaw repo black-box harness on `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, 240s canary timeout, and 30s per-sample timeout.

The SUT is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-01 normal-reply sweep](logs/2026-05-01-normal-reply.md).

<!-- stable-sweep:start -->

| npm version | Result | Samples | p50 | p95 |
|---|---:|---:|---:|---:|
| `2026.4.29` | Fail | 0 | - | - |
| `2026.4.27` | Pass | 20 | `15,458ms` | `29,035ms` |
| `2026.4.26` | Pass | 20 | `25,305ms` | `27,784ms` |
| `2026.4.25` | Fail | 0 | - | - |
| `2026.4.24` | Pass | 20 | `8,286ms` | `24,771ms` |
| `2026.4.23` | Fail | 0 | - | - |
| `2026.4.22` | Pass | 20 | `3,266ms` | `16,684ms` |
| `2026.4.21` | Pass | 20 | `4,303ms` | `23,807ms` |
| `2026.4.20` | Pass | 20 | `4,231ms` | `20,805ms` |
| `2026.4.15` | Pass | 20 | `4,652ms` | `16,338ms` |

<!-- stable-sweep:end -->
