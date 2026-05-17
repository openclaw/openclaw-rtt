# OpenClaw RTT

**Channel round-trip timing data for OpenClaw.** This repo stores normalized QA results and publishes the dashboard below; the harness itself lives in `openclaw/openclaw`.

Each row measures how long a real channel takes to receive an OpenClaw agent reply after the test driver sends a controlled message. So yes: a Discord row is the agent-turn reply time observed back in Discord; Telegram, Slack, WhatsApp, and future channels measure the same loop in their own channel/scenario.

RTT covers the whole observed path, not just model time:

```text
channel test driver -> OpenClaw channel transport -> gateway/agent turn -> outbound channel send -> reply observed by driver
```

That path can include channel API latency, polling/webhook timing, gateway routing, provider turn time, outbound send, and driver observation delay. `p50` is the median successful sample; `p95` is the tail sample. RSS appears when the importing workflow collected resource metrics; older release rows stay blank until an RSS backfill run updates only the resource fields.

Treat cross-channel numbers as coverage and regression signal, not a pure transport ranking. Telegram release rows use `telegram-mentioned-message-reply`; Discord release rows use `discord-canary`; Slack and WhatsApp use `openclaw qa <channel>` canaries where QA-lab overhead can inflate RSS. `-` cells mean no compatible imported run exists; `Not supported` means the older release predates or fails that canary contract.

Reports:

- [Dashboard](#dashboard)
- [Release Coverage Matrix](#release-coverage-matrix)
- [Telegram Release Runs](#telegram-release-runs)
- [Discord Release Runs](#discord-release-runs)
- [Slack Release Runs](#slack-release-runs)
- [WhatsApp Release Runs](#whatsapp-release-runs)

## Dashboard

Current `openclaw@main` channel snapshot. Channel jobs run on separate schedules, so the latest import time and latest version/ref sit above the compact table.

<!-- latest-main:start -->

Latest imported channel run: `2026-05-17T01:26:25.187Z` · latest `2026.5.17` / `d350ac3feb`

| Channel | Result | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|
| Telegram | Pass | `1,137ms` | `2,334ms` | - | - |
| Discord | Pass | `26,486ms` | `27,607ms` | - | - |
| Slack | Pass | `4,568ms` | `5,796ms` | `670MB` | `7,164MB` |
| WhatsApp | Pass | `7,485ms` | `8,382ms` | `828MB` | `6,968MB` |

<!-- latest-main:end -->

Operator notes: [Data imports and layout](docs/data-imports.md) · [Channel expansion](docs/channel-expansion.md).

## Release Coverage Matrix

Version-by-version RTT coverage for release canaries. The matrix shows the latest imported row for each channel family side by side.

Use this as release coverage and regression signal, not a channel speed ranking. Channel cells show RTT `p50` for that channel's release scenario; `p50 σ` is the standard deviation across available channel p50 values for that release. `-` means no compatible import exists, and `Not supported` means that release predates or fails the channel canary contract.

<!-- release-coverage:start -->

Latest imported channel run: `2026-05-17T02:00:29.509Z`

| Version | p50 σ | Telegram | Discord | Slack | WhatsApp |
|---|---:|---:|---:|---:|---:|
| `2026.5.16-beta.3` | `3,076ms` | `1,112ms` | - | `4,690ms` | `8,644ms` |
| `2026.5.16-beta.2` | `12,795ms` | `1,050ms` | `26,639ms` | - | - |
| `2026.5.16-beta.1` | `9,972ms` | `1,196ms` | `21,140ms` | - | - |
| `2026.5.14-beta.2` | `10,142ms` | `990ms` | `21,273ms` | - | - |
| `2026.5.14-beta.1` | `10,516ms` | `1,004ms` | `22,035ms` | - | - |
| `2026.5.12` | `8,891ms` | `2,858ms` | `20,640ms` | - | - |
| `2026.5.9-beta.1` | `7,121ms` | `2,517ms` | `16,759ms` | - | - |
| `2026.5.7` | `7,725ms` | `3,499ms` | `18,948ms` | - | - |
| `2026.5.6` | `7,252ms` | `3,497ms` | `18,001ms` | - | - |
| `2026.5.4` | `7,717ms` | `3,504ms` | `18,937ms` | - | - |
| `2026.5.3` | - | `3,505ms` | Not supported | - | - |
| `2026.5.2` | `8,323ms` | `3,501ms` | `20,146ms` | - | - |
| `2026.4.29` | - | `17,936ms` | Not supported | - | - |
| `2026.4.27` | `16,110ms` | `4,639ms` | `36,858ms` | - | - |
| `2026.4.26` | `13,405ms` | `5,880ms` | `32,689ms` | - | - |
| `2026.4.25` | `20,925ms` | `7,508ms` | `49,357ms` | - | - |
| `2026.4.24` | `15,325ms` | `2,679ms` | `33,328ms` | - | - |
| `2026.4.23` | - | `2,507ms` | Not supported | - | - |
| `2026.4.22` | - | `2,497ms` | Not supported | - | - |
| `2026.4.21` | - | `3,502ms` | Not supported | - | - |
| `2026.4.20` | - | `3,504ms` | Not supported | - | - |
| `2026.4.15` | - | `3,503ms` | Not supported | - | - |

<!-- release-coverage:end -->

## Telegram Release Runs

Telegram release runs use the OpenClaw repo black-box harness on Blacksmith with `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, a 240s canary timeout, and a 30s per-sample timeout.

The system under test is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

<!-- release-sweep:start -->

| npm version | Result | Samples | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.3` | Pass | 20 | `1,112ms` | `2,172ms` | `145MB` | `145MB` |
| `2026.5.16-beta.2` | Pass | 20 | `1,050ms` | `2,002ms` | `145MB` | `145MB` |
| `2026.5.16-beta.1` | Pass | 20 | `1,196ms` | `1,969ms` | `145MB` | `145MB` |
| `2026.5.14-beta.2` | Pass | 20 | `990ms` | `1,745ms` | `145MB` | `145MB` |
| `2026.5.14-beta.1` | Pass | 20 | `1,004ms` | `3,915ms` | - | - |
| `2026.5.12` | Pass | 20 | `2,858ms` | `23,061ms` | `135MB` | `135MB` |
| `2026.5.9-beta.1` | Pass | 20 | `2,517ms` | `14,692ms` | `134MB` | `134MB` |
| `2026.5.7` | Pass | 20 | `3,499ms` | `21,847ms` | `134MB` | `134MB` |
| `2026.5.6` | Pass | 20 | `3,497ms` | `16,762ms` | - | - |
| `2026.5.4` | Pass | 20 | `3,504ms` | `16,673ms` | `134MB` | `134MB` |
| `2026.5.3` | Pass | 20 | `3,505ms` | `16,741ms` | `136MB` | `136MB` |
| `2026.5.2` | Pass | 20 | `3,501ms` | `16,759ms` | `135MB` | `135MB` |
| `2026.4.29` | Pass | 20 | `17,936ms` | `24,517ms` | - | - |
| `2026.4.27` | Pass | 20 | `4,639ms` | `13,664ms` | - | - |
| `2026.4.26` | Pass | 20 | `5,880ms` | `18,610ms` | - | - |
| `2026.4.25` | Pass | 20 | `7,508ms` | `27,982ms` | `146MB` | `146MB` |
| `2026.4.24` | Pass | 20 | `2,679ms` | `13,451ms` | `133MB` | `133MB` |
| `2026.4.23` | Pass | 20 | `2,507ms` | `14,671ms` | `134MB` | `134MB` |
| `2026.4.22` | Pass | 20 | `2,497ms` | `14,847ms` | `135MB` | `135MB` |
| `2026.4.21` | Pass | 20 | `3,502ms` | `16,828ms` | `146MB` | `146MB` |
| `2026.4.20` | Pass | 20 | `3,504ms` | `16,796ms` | `136MB` | `136MB` |
| `2026.4.15` | Pass | 20 | `3,503ms` | `16,809ms` | `135MB` | `135MB` |

<!-- release-sweep:end -->

## Discord Release Runs

Discord release runs use the OpenClaw Discord QA harness with `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Older release tags that do not emit observed-message timestamps use sample duration.

<!-- discord-release-sweep:start -->

| npm version | Result | Samples | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.2` | Pass | 20 | `26,639ms` | `27,767ms` | `808MB` | `6,662MB` |
| `2026.5.16-beta.1` | Pass | 20 | `21,140ms` | `22,665ms` | `804MB` | `6,956MB` |
| `2026.5.14-beta.2` | Pass | 20 | `21,273ms` | `21,924ms` | `793MB` | `6,471MB` |
| `2026.5.14-beta.1` | Pass | 20 | `22,035ms` | `22,796ms` | `810MB` | `6,815MB` |
| `2026.5.12` | Pass | 20 | `20,640ms` | `22,622ms` | `792MB` | `6,717MB` |
| `2026.5.9-beta.1` | Pass | 20 | `16,759ms` | `18,006ms` | `775MB` | `2,302MB` |
| `2026.5.7` | Pass | 20 | `18,948ms` | `22,954ms` | `792MB` | `2,248MB` |
| `2026.5.6` | Pass | 20 | `18,001ms` | `18,832ms` | `797MB` | `2,270MB` |
| `2026.5.4` | Pass | 20 | `18,937ms` | `19,896ms` | `794MB` | `2,275MB` |
| `2026.5.2` | Pass | 20 | `20,146ms` | `21,604ms` | `719MB` | `2,301MB` |
| `2026.4.27` | Pass | 20 | `36,858ms` | `38,863ms` | `842MB` | `1,787MB` |
| `2026.4.26` | Pass | 20 | `32,689ms` | `34,092ms` | `762MB` | `1,496MB` |
| `2026.4.25` | Pass | 20 | `49,357ms` | `52,963ms` | `869MB` | `1,467MB` |
| `2026.4.24` | Pass | 20 | `33,328ms` | `34,734ms` | `767MB` | `1,574MB` |

<!-- discord-release-sweep:end -->

## Slack Release Runs

Slack release runs use the OpenClaw Slack QA harness with `mock-openai`, scenario `slack-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- slack-release-sweep:start -->

| npm version | Result | Samples | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.3` | Pass | 20 | `4,690ms` | `5,929ms` | `673MB` | `9,021MB` |

<!-- slack-release-sweep:end -->

## WhatsApp Release Runs

WhatsApp release runs use the OpenClaw WhatsApp QA harness with `mock-openai`, scenario `whatsapp-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- whatsapp-release-sweep:start -->

| npm version | Result | Samples | RTT p50 | RTT p95 | RSS p50 | RSS max |
|---|---:|---:|---:|---:|---:|---:|
| `2026.5.16-beta.3` | Pass | 20 | `8,644ms` | `9,572ms` | `894MB` | `7,111MB` |

<!-- whatsapp-release-sweep:end -->
