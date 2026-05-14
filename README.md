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
| `2026.5.12-beta.1+f3361dc928` | Pass | 20 | `902ms` | `2,008ms` | `2026-05-14T01:01:12.207Z` |

<!-- latest-main:end -->

## Latest Stable Sweep

Measured on 2026-05-02 with the OpenClaw repo black-box harness on Blacksmith Testbox using `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, 240s canary timeout, and 30s per-sample timeout.

The SUT is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

<!-- stable-sweep:start -->

| npm version | Result | Samples | p50 | p95 |
|---|---:|---:|---:|---:|
| `2026.5.7` | Pass | 20 | `3,499ms` | `21,847ms` |
| `2026.5.6` | Pass | 20 | `3,497ms` | `16,762ms` |
| `2026.5.4` | Pass | 20 | `3,504ms` | `16,673ms` |
| `2026.5.3` | Pass | 20 | `3,505ms` | `16,741ms` |
| `2026.5.2` | Pass | 20 | `3,501ms` | `16,759ms` |
| `2026.4.29` | Pass | 20 | `17,936ms` | `24,517ms` |
| `2026.4.27` | Pass | 20 | `4,639ms` | `13,664ms` |
| `2026.4.26` | Pass | 20 | `5,880ms` | `18,610ms` |
| `2026.4.25` | Pass | 20 | `7,508ms` | `27,982ms` |
| `2026.4.24` | Pass | 20 | `2,679ms` | `13,451ms` |
| `2026.4.23` | Pass | 20 | `2,507ms` | `14,671ms` |
| `2026.4.22` | Pass | 20 | `2,497ms` | `14,847ms` |
| `2026.4.21` | Pass | 20 | `3,502ms` | `16,828ms` |
| `2026.4.20` | Pass | 20 | `3,504ms` | `16,796ms` |
| `2026.4.15` | Pass | 20 | `3,503ms` | `16,809ms` |

<!-- stable-sweep:end -->
