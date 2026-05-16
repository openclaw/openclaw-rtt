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

Current `openclaw@main` channel snapshot. Channel jobs run on separate schedules, so each row keeps its own update time.

<!-- latest-main:start -->

Latest imported channel run: `2026-05-16T13:47:20.951Z`

| Channel | Scope | Scenario | Version/ref | Result | Samples | Retries | RTT p50 | RTT p95 | RSS p50 | RSS max | Updated |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Telegram | Main | `telegram-mentioned-message-reply` | `2026.5.16+df0d061c7a` | Pass | 20 | - | `1,126ms` | `2,089ms` | - | - | `2026-05-16T06:56:44.998Z` |
| Discord | Main | `discord-canary` | `2026.5.16+e975c3b212` | Pass | 20 | - | `6,590ms` | `6,952ms` | - | - | `2026-05-16T07:18:04.544Z` |
| Slack | Main | `slack-canary` | `2026.5.17+b9921e21b9` | Pass | 20 | 0 | `4,536ms` | `5,893ms` | `672MB` | `7,362MB` | `2026-05-16T13:38:09.440Z` |
| WhatsApp | Main | `whatsapp-canary` | `2026.5.17+b9921e21b9` | Pass | 20 | 0 | `8,184ms` | `9,018ms` | `831MB` | `7,353MB` | `2026-05-16T13:47:20.951Z` |

<!-- latest-main:end -->

## Telegram Release Sweep

Measured with the OpenClaw repo black-box harness on Blacksmith using `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, 240s canary timeout, and 30s per-sample timeout.

The SUT is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

End-to-end latency measured over Telegram using `mock-openai`. 

<!-- release-sweep:start -->

| npm version | Result | Samples | p50 | p95 | Updated |
|---|---:|---:|---:|---:|---:|
| `2026.5.16-beta.2` | Pass | 20 | `1,050ms` | `2,002ms` | `2026-05-16T11:52:22.056Z` |
| `2026.5.16-beta.1` | Pass | 20 | `1,196ms` | `1,969ms` | `2026-05-16T07:03:30.628Z` |
| `2026.5.14-beta.2` | Pass | 20 | `990ms` | `1,745ms` | `2026-05-15T11:25:24.501Z` |
| `2026.5.14-beta.1` | Pass | 20 | `1,004ms` | `3,915ms` | `2026-05-15T12:12:25.166Z` |
| `2026.5.12` | Pass | 20 | `2,858ms` | `23,061ms` | `2026-05-15T14:57:36.884Z` |
| `2026.5.9-beta.1` | Pass | 20 | `2,517ms` | `14,692ms` | `2026-05-09T13:46:04.963Z` |
| `2026.5.7` | Pass | 20 | `3,499ms` | `21,847ms` | `2026-05-07T22:34:10.660Z` |
| `2026.5.6` | Pass | 20 | `3,497ms` | `16,762ms` | `2026-05-07T01:10:20.034Z` |
| `2026.5.4` | Pass | 20 | `3,504ms` | `16,673ms` | `2026-05-05T12:55:16.706Z` |
| `2026.5.3` | Pass | 20 | `3,505ms` | `16,741ms` | `2026-05-04T09:49:15.970Z` |
| `2026.5.2` | Pass | 20 | `3,501ms` | `16,759ms` | `2026-05-03T01:14:23.528Z` |
| `2026.4.29` | Pass | 20 | `17,936ms` | `24,517ms` | `2026-05-02T06:17:26.914Z` |
| `2026.4.27` | Pass | 20 | `4,639ms` | `13,664ms` | `2026-05-02T06:11:35.226Z` |
| `2026.4.26` | Pass | 20 | `5,880ms` | `18,610ms` | `2026-05-02T06:05:19.893Z` |
| `2026.4.25` | Pass | 20 | `7,508ms` | `27,982ms` | `2026-05-02T05:59:20.038Z` |
| `2026.4.24` | Pass | 20 | `2,679ms` | `13,451ms` | `2026-05-02T05:54:14.272Z` |
| `2026.4.23` | Pass | 20 | `2,507ms` | `14,671ms` | `2026-05-02T05:49:14.713Z` |
| `2026.4.22` | Pass | 20 | `2,497ms` | `14,847ms` | `2026-05-02T05:34:51.113Z` |
| `2026.4.21` | Pass | 20 | `3,502ms` | `16,828ms` | `2026-05-02T05:43:01.319Z` |
| `2026.4.20` | Pass | 20 | `3,504ms` | `16,796ms` | `2026-05-02T05:26:57.320Z` |
| `2026.4.15` | Pass | 20 | `3,503ms` | `16,809ms` | `2026-05-02T05:20:28.620Z` |

<!-- release-sweep:end -->

## Discord Release Sweep

Measured with the OpenClaw Discord QA harness using `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Older release tags that do not emit observed-message timestamps use sample duration.

<!-- discord-release-sweep:start -->

| npm version | Result | Samples | p50 | p95 | Updated |
|---|---:|---:|---:|---:|---:|
| `2026.5.16-beta.2` | Pass | 20 | `26,639ms` | `27,767ms` | `2026-05-16T13:20:58.769Z` |
| `2026.5.16-beta.1` | Pass | 20 | `21,140ms` | `22,665ms` | `2026-05-16T13:04:27.192Z` |
| `2026.5.14-beta.2` | Pass | 20 | `21,273ms` | `21,924ms` | `2026-05-16T12:48:02.968Z` |
| `2026.5.14-beta.1` | Pass | 20 | `22,035ms` | `22,796ms` | `2026-05-16T12:31:17.042Z` |

<!-- discord-release-sweep:end -->

## Channel Expansion

Generic live-transport RTT imports for channels backed by `pnpm openclaw qa <channel>`. New channels should land one at a time with their workflow, credential contract, scenario id, and importer proof.
Design notes: [Channel expansion](docs/channel-expansion.md).

<!-- channel-rtt:start -->

| Channel | Version/ref | Result | Samples | RTT p50 | RTT p95 | RSS p50 | RSS max | Updated |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Slack | `2026.5.17+b9921e21b9` | Pass | 20 | `4,536ms` | `5,893ms` | `672MB` | `7,362MB` | `2026-05-16T13:38:09.440Z` |
| WhatsApp | `2026.5.17+b9921e21b9` | Pass | 20 | `8,184ms` | `9,018ms` | `831MB` | `7,353MB` | `2026-05-16T13:47:20.951Z` |

<!-- channel-rtt:end -->
