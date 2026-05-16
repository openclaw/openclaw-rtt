# OpenClaw RTT

Time-series store for OpenClaw Telegram, Discord, Slack, WhatsApp, and other channel RTT measurements.

The measurement harness lives in `openclaw/openclaw`. This repo stores normalized results and the README dashboard.

## Import A Run

From this repo:

```sh
node scripts/import-result.mjs ../clawdbot/runs/<run-id>/result.json
node scripts/import-discord-rtt.mjs samples.tsv --spec openclaw@main --version <ref>
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
- `data/discord-rtt.jsonl`: append-only Discord RTT graph source.
- `discord-runs/<run-id>/result.json`: copied per-run Discord RTT record.
- `data/channel-rtt/<channel>.jsonl`: append-only graph source for new live-transport channel RTT runs.
- `channel-runs/<channel>/<run-id>/result.json`: copied per-run channel result record.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied in later.

## Dashboard

Current `openclaw@main` channel snapshot. Channel jobs run on separate schedules, so the latest import time and per-channel refs sit above the compact table.

<!-- latest-main:start -->

Latest imported channel run: `2026-05-16T13:47:20.951Z`
Version/ref: Telegram `2026.5.16+df0d061c7a`; Discord `2026.5.16+e975c3b212`; Slack/WhatsApp `2026.5.17+b9921e21b9`

| Channel | Result | RTT p50 | RTT p95 | RSS p50 | RSS max | Scenario |
|---|---:|---:|---:|---:|---:|---:|
| Telegram | Pass | `1,126ms` | `2,089ms` | - | - | `telegram-mentioned-message-reply` |
| Discord | Pass | `6,590ms` | `6,952ms` | - | - | `discord-canary` |
| Slack | Pass | `4,536ms` | `5,893ms` | `672MB` | `7,362MB` | `slack-canary` |
| WhatsApp | Pass | `8,184ms` | `9,018ms` | `831MB` | `7,353MB` | `whatsapp-canary` |

<!-- latest-main:end -->

## Release Coverage

Version-by-version release coverage across channel families. The Discord release workflow queues missing versions from the Telegram release baseline before future versions.

These cells are useful for coverage, not cross-channel latency ranking: Telegram uses `telegram-mentioned-message-reply`; Discord release rows use `discord-canary`, and canary scenarios are not strict apples-to-apples with Telegram mention replies.

<!-- release-coverage:start -->

Latest imported channel run: `2026-05-16T16:22:30.074Z`

Discord release gap: none; 7 Telegram versions are not supported by the Discord release canary.

| Version | Telegram | Discord |
|---|---:|---:|
| `2026.5.16-beta.2` | `1,050ms` / `2,002ms` | `26,639ms` / `27,767ms` |
| `2026.5.16-beta.1` | `1,196ms` / `1,969ms` | `21,140ms` / `22,665ms` |
| `2026.5.14-beta.2` | `990ms` / `1,745ms` | `21,273ms` / `21,924ms` |
| `2026.5.14-beta.1` | `1,004ms` / `3,915ms` | `22,035ms` / `22,796ms` |
| `2026.5.12` | `2,858ms` / `23,061ms` | `20,640ms` / `22,622ms` |
| `2026.5.9-beta.1` | `2,517ms` / `14,692ms` | `16,759ms` / `18,006ms` |
| `2026.5.7` | `3,499ms` / `21,847ms` | `18,948ms` / `22,954ms` |
| `2026.5.6` | `3,497ms` / `16,762ms` | `18,001ms` / `18,832ms` |
| `2026.5.4` | `3,504ms` / `16,673ms` | `18,937ms` / `19,896ms` |
| `2026.5.3` | `3,505ms` / `16,741ms` | Not supported |
| `2026.5.2` | `3,501ms` / `16,759ms` | `20,146ms` / `21,604ms` |
| `2026.4.29` | `17,936ms` / `24,517ms` | Not supported |
| `2026.4.27` | `4,639ms` / `13,664ms` | `36,858ms` / `38,863ms` |
| `2026.4.26` | `5,880ms` / `18,610ms` | `32,689ms` / `34,092ms` |
| `2026.4.25` | `7,508ms` / `27,982ms` | `49,357ms` / `52,963ms` |
| `2026.4.24` | `2,679ms` / `13,451ms` | `33,328ms` / `34,734ms` |
| `2026.4.23` | `2,507ms` / `14,671ms` | Not supported |
| `2026.4.22` | `2,497ms` / `14,847ms` | Not supported |
| `2026.4.21` | `3,502ms` / `16,828ms` | Not supported |
| `2026.4.20` | `3,504ms` / `16,796ms` | Not supported |
| `2026.4.15` | `3,503ms` / `16,809ms` | Not supported |

<!-- release-coverage:end -->

## Telegram Release Sweep

Measured with the OpenClaw repo black-box harness on Blacksmith using `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, 240s canary timeout, and 30s per-sample timeout.

The SUT is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

End-to-end latency measured over Telegram using `mock-openai`. 

<!-- release-sweep:start -->

| npm version | Result | Samples | p50 | p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.2` | Pass | 20 | `1,050ms` | `2,002ms` | - | - |
| `2026.5.16-beta.1` | Pass | 20 | `1,196ms` | `1,969ms` | - | - |
| `2026.5.14-beta.2` | Pass | 20 | `990ms` | `1,745ms` | - | - |
| `2026.5.14-beta.1` | Pass | 20 | `1,004ms` | `3,915ms` | - | - |
| `2026.5.12` | Pass | 20 | `2,858ms` | `23,061ms` | - | - |
| `2026.5.9-beta.1` | Pass | 20 | `2,517ms` | `14,692ms` | - | - |
| `2026.5.7` | Pass | 20 | `3,499ms` | `21,847ms` | - | - |
| `2026.5.6` | Pass | 20 | `3,497ms` | `16,762ms` | - | - |
| `2026.5.4` | Pass | 20 | `3,504ms` | `16,673ms` | - | - |
| `2026.5.3` | Pass | 20 | `3,505ms` | `16,741ms` | - | - |
| `2026.5.2` | Pass | 20 | `3,501ms` | `16,759ms` | - | - |
| `2026.4.29` | Pass | 20 | `17,936ms` | `24,517ms` | - | - |
| `2026.4.27` | Pass | 20 | `4,639ms` | `13,664ms` | - | - |
| `2026.4.26` | Pass | 20 | `5,880ms` | `18,610ms` | - | - |
| `2026.4.25` | Pass | 20 | `7,508ms` | `27,982ms` | - | - |
| `2026.4.24` | Pass | 20 | `2,679ms` | `13,451ms` | - | - |
| `2026.4.23` | Pass | 20 | `2,507ms` | `14,671ms` | - | - |
| `2026.4.22` | Pass | 20 | `2,497ms` | `14,847ms` | - | - |
| `2026.4.21` | Pass | 20 | `3,502ms` | `16,828ms` | - | - |
| `2026.4.20` | Pass | 20 | `3,504ms` | `16,796ms` | - | - |
| `2026.4.15` | Pass | 20 | `3,503ms` | `16,809ms` | - | - |

<!-- release-sweep:end -->

## Discord Release Sweep

Measured with the OpenClaw Discord QA harness using `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Older release tags that do not emit observed-message timestamps use sample duration.

<!-- discord-release-sweep:start -->

| npm version | Result | Samples | p50 | p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.2` | Pass | 20 | `26,639ms` | `27,767ms` | - | - |
| `2026.5.16-beta.1` | Pass | 20 | `21,140ms` | `22,665ms` | - | - |
| `2026.5.14-beta.2` | Pass | 20 | `21,273ms` | `21,924ms` | - | - |
| `2026.5.14-beta.1` | Pass | 20 | `22,035ms` | `22,796ms` | - | - |
| `2026.5.12` | Pass | 20 | `20,640ms` | `22,622ms` | - | - |
| `2026.5.9-beta.1` | Pass | 20 | `16,759ms` | `18,006ms` | - | - |
| `2026.5.7` | Pass | 20 | `18,948ms` | `22,954ms` | - | - |
| `2026.5.6` | Pass | 20 | `18,001ms` | `18,832ms` | - | - |
| `2026.5.4` | Pass | 20 | `18,937ms` | `19,896ms` | - | - |
| `2026.5.2` | Pass | 20 | `20,146ms` | `21,604ms` | - | - |
| `2026.4.27` | Pass | 20 | `36,858ms` | `38,863ms` | - | - |
| `2026.4.26` | Pass | 20 | `32,689ms` | `34,092ms` | - | - |
| `2026.4.25` | Pass | 20 | `49,357ms` | `52,963ms` | - | - |
| `2026.4.24` | Pass | 20 | `33,328ms` | `34,734ms` | - | - |

<!-- discord-release-sweep:end -->

## Channel Expansion

Generic live-transport RTT imports for channels backed by `pnpm openclaw qa <channel>`. New channels should land one at a time with their workflow, credential contract, scenario id, and importer proof.
Slack and WhatsApp rows come from `openclaw qa <channel>` canaries, so their RSS columns include the QA-lab sample process and should not be read as pure channel transport memory.
Design notes: [Channel expansion](docs/channel-expansion.md).

<!-- channel-rtt:start -->

Merged into the Dashboard table above.

<!-- channel-rtt:end -->
