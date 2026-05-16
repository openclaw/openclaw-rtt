# OpenClaw RTT

**Channel round-trip timing data for OpenClaw.** `openclaw-rtt` stores normalized results from real OpenClaw channel QA runs and publishes the compact dashboard below.

Practical answer: a Discord row measures how long it takes for an OpenClaw agent turn to produce a reply that is observable back in Discord. Telegram, Slack, WhatsApp, and future channel rows measure the same channel-observed reply loop for their own scenario.

The measurement harness lives in `openclaw/openclaw`; this repo is the data and reporting layer. It stays focused: import normalized run artifacts, keep append-only history, regenerate the README tables, and make regressions easy to spot.

## What It Measures

Each run sends a controlled message through a real channel credential, lets OpenClaw route it through the configured agent/provider path, then waits until the expected reply appears back in that channel.

The RTT is the elapsed time for that observed reply loop:

```text
channel test driver -> OpenClaw channel transport -> gateway/agent turn -> outbound channel send -> reply observed by driver
```

That means the numbers include more than model latency. They can include channel API latency, polling or webhook timing, gateway routing, mock-provider turn time, outbound send time, and test-driver observation delay. `p50` is the median successful sample; `p95` is the tail sample for the same run. RSS columns are only populated for newer generic channel lanes that collect process resource metrics.

Do not read different scenarios as strict apples-to-apples transport benchmarks. Telegram release rows currently use `telegram-mentioned-message-reply`; Discord release rows use `discord-canary`; Slack and WhatsApp use `openclaw qa <channel>` canaries, where QA-lab process overhead can inflate RSS.

## Reporting Data

`main` is the latest imported channel snapshot. Release tables compare published OpenClaw package versions where that channel has a compatible canary. Missing cells mean no imported compatible run exists; `Not supported` means the older OpenClaw release predates or fails that channel canary contract.

## Dashboard

Current `openclaw@main` channel snapshot. Channel jobs run on separate schedules, so the latest import time and per-channel refs sit above the compact table.

<!-- latest-main:start -->

Latest imported channel run: `2026-05-16T13:47:20.951Z`
Version/ref: Telegram `2026.5.16+df0d061c7a`; Discord `2026.5.16+e975c3b212`; Slack/WhatsApp `2026.5.17+b9921e21b9`

| Channel | Result | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|
| Telegram | Pass | `1,126ms` | `2,089ms` | - | - |
| Discord | Pass | `6,590ms` | `6,952ms` | - | - |
| Slack | Pass | `4,536ms` | `5,893ms` | `672MB` | `7,362MB` |
| WhatsApp | Pass | `8,184ms` | `9,018ms` | `831MB` | `7,353MB` |

<!-- latest-main:end -->

## Quick Start

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

## Data Layout

- `data/rtt.jsonl`: append-only graph source, one normalized run per line.
- `runs/<run-id>/result.json`: copied per-run result record for audit/debug.
- `data/discord-rtt.jsonl`: append-only Discord RTT graph source.
- `discord-runs/<run-id>/result.json`: copied per-run Discord RTT record.
- `data/channel-rtt/<channel>.jsonl`: append-only graph source for new live-transport channel RTT runs.
- `channel-runs/<channel>/<run-id>/result.json`: copied per-run channel result record.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied in later.

## Release Coverage Matrix

Version-by-version release coverage across channel families. The Discord release workflow queues missing versions from the Telegram release baseline before future versions.

These cells are useful for coverage, not cross-channel latency ranking. The value shown is `p50 / p95` for that channel's release scenario.

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

## Telegram Release Runs

Telegram release runs use the OpenClaw repo black-box harness on Blacksmith with `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, a 240s canary timeout, and a 30s per-sample timeout.

The system under test is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

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

## Discord Release Runs

Discord release runs use the OpenClaw Discord QA harness with `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Older release tags that do not emit observed-message timestamps use sample duration.

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

## Adding Channels

Generic live-transport RTT imports are for channels backed by `pnpm openclaw qa <channel>`. New channels should land one at a time with their workflow, credential contract, scenario id, and importer proof.
Slack and WhatsApp rows come from `openclaw qa <channel>` canaries, so their RSS columns include the QA-lab sample process and should not be read as pure channel transport memory.
Design notes: [Channel expansion](docs/channel-expansion.md).

<!-- channel-rtt:start -->

Merged into the Dashboard table above.

<!-- channel-rtt:end -->
