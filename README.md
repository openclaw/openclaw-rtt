# OpenClaw RTT

**Channel round-trip timing data for OpenClaw.** This repo stores normalized QA results and publishes the dashboard below; the harness itself lives in `openclaw/openclaw`.

Each row measures how long a real channel takes to receive an OpenClaw agent reply after the test driver sends a controlled message. So yes: a Discord row is the agent-turn reply time observed back in Discord; Telegram, Slack, WhatsApp, and future channels measure the same loop in their own channel/scenario.

RTT covers the whole observed path, not just model time:

```text
channel test driver -> OpenClaw channel transport -> gateway/agent turn -> outbound channel send -> reply observed by driver
```

That path can include channel API latency, polling/webhook timing, gateway routing, provider turn time, outbound send, and driver observation delay. `p50` is the median successful sample; `p95` is the tail sample. RSS appears when the importing workflow collected process resource metrics around the sampled command; older release rows stay blank until an RSS backfill run updates only the resource fields.

Treat cross-channel numbers as coverage and regression signal, not a pure transport ranking. Telegram release rows use `telegram-mentioned-message-reply`; Discord release rows use `discord-canary`; Slack and WhatsApp use `openclaw qa <channel>` canaries. RSS is not pure channel transport memory: for Discord, Slack, and WhatsApp it includes the QA-lab command process and any cold-start overhead. `-` cells mean no successful RTT sample was imported for that channel/version yet, or an imported all-failed run exists but produced no usable RTT value.

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

Latest imported channel run: `2026-05-20T07:47:18.364Z` · latest `2026.5.19` / `110042d840`

| Channel | RTT p50 | RTT p95 | RSS p50 | RSS p95 |
|---|---:|---:|---:|---:|
| Telegram | `1,037ms` | `2,417ms` | `134MB` | `134MB` |
| Discord | `7,479ms` | `7,623ms` | `780MB` | `814MB` |
| Slack | `4,931ms` | `6,419ms` | `712MB` | `752MB` |
| WhatsApp | `8,322ms` | `9,956ms` | `915MB` | `1,556MB` |

<!-- latest-main:end -->

Operator notes: [Data imports and layout](docs/data-imports.md) · [Channel expansion](docs/channel-expansion.md).

## Release Coverage Matrix

Version-by-version RTT coverage for release canaries. The matrix follows imported release versions from `2026.4.24` onward and leaves missing channel/version cells as `-`. A `-` cell means no compatible row exists for that channel/version yet, or an imported row produced no successful RTT sample.

Use this as release coverage and regression signal, not a channel speed ranking. Channel cells show RTT `p50` for that channel's release scenario; `p50 σ` is the standard deviation across channel p50 values for that release. Older Telegram/Discord-only history remains in the per-channel release tables below.

<!-- release-coverage:start -->

Latest imported channel run: `2026-05-20T07:33:37.473Z`

| Version | p50 σ | Telegram | Discord | Slack | WhatsApp |
|---|---:|---:|---:|---:|---:|
| `2026.5.19-beta.2` | - | `1,036ms` | - | - | - |
| `2026.5.19-beta.1` | `1,934ms` | `1,224ms` | `5,092ms` | - | - |
| `2026.5.18` | `3,129ms` | `1,061ms` | `7,318ms` | - | - |
| `2026.5.18-beta.1` | `2,470ms` | `1,017ms` | `5,957ms` | - | - |
| `2026.5.16-beta.7` | `2,425ms` | `1,583ms` | `7,307ms` | `4,704ms` | `7,607ms` |
| `2026.5.16-beta.6` | `2,469ms` | `1,417ms` | `7,844ms` | `4,719ms` | `6,886ms` |
| `2026.5.16-beta.5` | `2,640ms` | `1,386ms` | - | `4,703ms` | `7,853ms` |
| `2026.5.16-beta.4` | `9,795ms` | `1,221ms` | `26,263ms` | `4,255ms` | `6,888ms` |
| `2026.5.16-beta.3` | `9,873ms` | `1,112ms` | `26,771ms` | `4,690ms` | `8,644ms` |
| `2026.5.16-beta.2` | `9,836ms` | `1,050ms` | `26,639ms` | `4,751ms` | `8,377ms` |
| `2026.5.16-beta.1` | `7,659ms` | `1,196ms` | `21,140ms` | `4,205ms` | `6,714ms` |
| `2026.5.14-beta.2` | `7,725ms` | `990ms` | `21,273ms` | `4,621ms` | `6,439ms` |
| `2026.5.14-beta.1` | `8,082ms` | `1,004ms` | `22,035ms` | `4,211ms` | `6,636ms` |
| `2026.5.12` | `7,071ms` | `2,858ms` | `20,640ms` | `4,170ms` | `7,035ms` |
| `2026.5.9-beta.1` | `5,604ms` | `2,517ms` | `16,759ms` | `4,488ms` | `4,971ms` |
| `2026.5.7` | `6,981ms` | `3,499ms` | `18,948ms` | `4,877ms` | - |
| `2026.5.6` | `6,537ms` | `3,497ms` | `18,001ms` | `4,876ms` | - |
| `2026.5.4` | `6,926ms` | `3,504ms` | `18,937ms` | `5,121ms` | - |
| `2026.5.3` | `738ms` | `3,505ms` | - | `4,980ms` | - |
| `2026.5.2` | `8,323ms` | `3,501ms` | `20,146ms` | - | - |
| `2026.4.29` | - | `17,936ms` | - | - | - |
| `2026.4.27` | `16,110ms` | `4,639ms` | `36,858ms` | - | - |
| `2026.4.26` | `13,405ms` | `5,880ms` | `32,689ms` | - | - |
| `2026.4.25` | `20,925ms` | `7,508ms` | `49,357ms` | - | - |
| `2026.4.24` | `15,325ms` | `2,679ms` | `33,328ms` | - | - |

<!-- release-coverage:end -->

## Telegram Release Runs

Telegram release runs use the OpenClaw repo black-box harness on Blacksmith with `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, a 240s canary timeout, and a 30s per-sample timeout.

The system under test is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

<!-- release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 |
|---|---:|---:|---:|---:|
| `2026.5.19-beta.2` | `1,036ms` | `2,404ms` | `145MB` | `145MB` |
| `2026.5.19-beta.1` | `1,224ms` | `2,703ms` | `145MB` | `145MB` |
| `2026.5.18` | `1,061ms` | `12,713ms` | `140MB` | `140MB` |
| `2026.5.18-beta.1` | `1,017ms` | `2,421ms` | `145MB` | `145MB` |
| `2026.5.16-beta.7` | `1,583ms` | `2,601ms` | `147MB` | `147MB` |
| `2026.5.16-beta.6` | `1,417ms` | `13,429ms` | `135MB` | `135MB` |
| `2026.5.16-beta.5` | `1,386ms` | `3,823ms` | `145MB` | `145MB` |
| `2026.5.16-beta.4` | `1,221ms` | `2,077ms` | `145MB` | `145MB` |
| `2026.5.16-beta.3` | `1,112ms` | `2,172ms` | `145MB` | `145MB` |
| `2026.5.16-beta.2` | `1,050ms` | `2,002ms` | `145MB` | `145MB` |
| `2026.5.16-beta.1` | `1,196ms` | `1,969ms` | `145MB` | `145MB` |
| `2026.5.14-beta.2` | `990ms` | `1,745ms` | `145MB` | `145MB` |
| `2026.5.14-beta.1` | `1,004ms` | `3,915ms` | `146MB` | `146MB` |
| `2026.5.12` | `2,858ms` | `23,061ms` | `135MB` | `135MB` |
| `2026.5.9-beta.1` | `2,517ms` | `14,692ms` | `134MB` | `134MB` |
| `2026.5.7` | `3,499ms` | `21,847ms` | `134MB` | `134MB` |
| `2026.5.6` | `3,497ms` | `16,762ms` | `135MB` | `135MB` |
| `2026.5.4` | `3,504ms` | `16,673ms` | `134MB` | `134MB` |
| `2026.5.3` | `3,505ms` | `16,741ms` | `136MB` | `136MB` |
| `2026.5.2` | `3,501ms` | `16,759ms` | `135MB` | `135MB` |
| `2026.4.29` | `17,936ms` | `24,517ms` | n/a | n/a |
| `2026.4.27` | `4,639ms` | `13,664ms` | `134MB` | `134MB` |
| `2026.4.26` | `5,880ms` | `18,610ms` | `135MB` | `135MB` |
| `2026.4.25` | `7,508ms` | `27,982ms` | `146MB` | `146MB` |
| `2026.4.24` | `2,679ms` | `13,451ms` | `133MB` | `133MB` |
| `2026.4.23` | `2,507ms` | `14,671ms` | `134MB` | `134MB` |
| `2026.4.22` | `2,497ms` | `14,847ms` | `135MB` | `135MB` |
| `2026.4.21` | `3,502ms` | `16,828ms` | `146MB` | `146MB` |
| `2026.4.20` | `3,504ms` | `16,796ms` | `136MB` | `136MB` |
| `2026.4.15` | `3,503ms` | `16,809ms` | `135MB` | `135MB` |

<!-- release-sweep:end -->

## Discord Release Runs

Discord release runs use the OpenClaw Discord QA harness with `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Older release tags that do not emit observed-message timestamps use sample duration.

<!-- discord-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 |
|---|---:|---:|---:|---:|
| `2026.5.19-beta.1` | `5,092ms` | `5,294ms` | `742MB` | `755MB` |
| `2026.5.18` | `7,318ms` | `7,657ms` | `768MB` | `783MB` |
| `2026.5.18-beta.1` | `5,957ms` | `6,083ms` | `770MB` | `783MB` |
| `2026.5.16-beta.7` | `7,307ms` | `7,792ms` | `766MB` | `782MB` |
| `2026.5.16-beta.6` | `7,844ms` | `7,844ms` | `768MB` | `779MB` |
| `2026.5.16-beta.5` | - | - | `768MB` | `781MB` |
| `2026.5.16-beta.4` | `26,263ms` | `28,304ms` | `779MB` | `815MB` |
| `2026.5.16-beta.3` | `26,771ms` | `28,550ms` | `812MB` | `825MB` |
| `2026.5.16-beta.2` | `26,639ms` | `27,767ms` | `808MB` | `820MB` |
| `2026.5.16-beta.1` | `21,140ms` | `22,665ms` | `804MB` | `816MB` |
| `2026.5.14-beta.2` | `21,273ms` | `21,924ms` | `793MB` | `816MB` |
| `2026.5.14-beta.1` | `22,035ms` | `22,796ms` | `810MB` | `848MB` |
| `2026.5.12` | `20,640ms` | `22,622ms` | `792MB` | `810MB` |
| `2026.5.9-beta.1` | `16,759ms` | `18,006ms` | `775MB` | `803MB` |
| `2026.5.7` | `18,948ms` | `22,954ms` | `792MB` | `823MB` |
| `2026.5.6` | `18,001ms` | `18,832ms` | `797MB` | `807MB` |
| `2026.5.4` | `18,937ms` | `19,896ms` | `794MB` | `810MB` |
| `2026.5.2` | `20,146ms` | `21,604ms` | `719MB` | `724MB` |
| `2026.4.27` | `36,858ms` | `38,863ms` | `842MB` | `961MB` |
| `2026.4.26` | `32,689ms` | `34,092ms` | `762MB` | `779MB` |
| `2026.4.25` | `49,357ms` | `52,963ms` | `869MB` | `884MB` |
| `2026.4.24` | `33,328ms` | `34,734ms` | `767MB` | `842MB` |

<!-- discord-release-sweep:end -->

## Slack Release Runs

Slack release runs use the OpenClaw Slack QA harness with `mock-openai`, scenario `slack-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- slack-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 |
|---|---:|---:|---:|---:|
| `2026.5.16-beta.7` | `4,704ms` | `6,118ms` | `699MB` | `762MB` |
| `2026.5.16-beta.6` | `4,719ms` | `5,051ms` | `724MB` | `760MB` |
| `2026.5.16-beta.5` | `4,703ms` | `4,791ms` | `725MB` | `1,008MB` |
| `2026.5.16-beta.4` | `4,255ms` | `5,484ms` | `671MB` | `709MB` |
| `2026.5.16-beta.3` | `4,690ms` | `5,929ms` | `673MB` | `723MB` |
| `2026.5.16-beta.2` | `4,751ms` | `5,868ms` | `672MB` | `696MB` |
| `2026.5.16-beta.1` | `4,205ms` | `4,459ms` | `659MB` | `691MB` |
| `2026.5.14-beta.2` | `4,621ms` | `5,344ms` | `671MB` | `722MB` |
| `2026.5.14-beta.1` | `4,211ms` | `4,447ms` | `681MB` | `736MB` |
| `2026.5.12` | `4,170ms` | `4,381ms` | `708MB` | `717MB` |
| `2026.5.9-beta.1` | `4,488ms` | `4,708ms` | `621MB` | `626MB` |
| `2026.5.7` | `4,877ms` | `4,928ms` | `643MB` | `681MB` |
| `2026.5.6` | `4,876ms` | `5,564ms` | `649MB` | `671MB` |
| `2026.5.4` | `5,121ms` | `5,482ms` | `651MB` | `659MB` |
| `2026.5.3` | `4,980ms` | `5,146ms` | `628MB` | `631MB` |

<!-- slack-release-sweep:end -->

## WhatsApp Release Runs

WhatsApp release runs use the OpenClaw WhatsApp QA harness with `mock-openai`, scenario `whatsapp-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- whatsapp-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 |
|---|---:|---:|---:|---:|
| `2026.5.16-beta.7` | `7,607ms` | `9,241ms` | `838MB` | `2,714MB` |
| `2026.5.16-beta.6` | `6,886ms` | `7,819ms` | `891MB` | `1,368MB` |
| `2026.5.16-beta.5` | `7,853ms` | `8,684ms` | `903MB` | `1,546MB` |
| `2026.5.16-beta.4` | `6,888ms` | `8,290ms` | `868MB` | `1,599MB` |
| `2026.5.16-beta.3` | `8,644ms` | `9,572ms` | `894MB` | `1,593MB` |
| `2026.5.16-beta.2` | `8,377ms` | `10,642ms` | `1,006MB` | `1,495MB` |
| `2026.5.16-beta.1` | `6,714ms` | `7,367ms` | `1,487MB` | `1,521MB` |
| `2026.5.14-beta.2` | `6,439ms` | `7,602ms` | `740MB` | `872MB` |
| `2026.5.14-beta.1` | `6,636ms` | `7,158ms` | `859MB` | `906MB` |
| `2026.5.12` | `7,035ms` | `8,106ms` | `857MB` | `893MB` |
| `2026.5.9-beta.1` | `4,971ms` | `6,231ms` | `851MB` | `879MB` |

<!-- whatsapp-release-sweep:end -->
