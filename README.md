# OpenClaw RTT

![OpenClaw RTT banner](docs/assets/readme-banner.jpg)

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
- [Surface Dashboard](#surface-dashboard)
- [Release Coverage Matrix](#release-coverage-matrix)
- [Surface Release Coverage](#surface-release-coverage)
- [Telegram Release Runs](#telegram-release-runs)
- [Discord Release Runs](#discord-release-runs)
- [Slack Release Runs](#slack-release-runs)
- [WhatsApp Release Runs](#whatsapp-release-runs)

## Dashboard

Current `openclaw@main` channel snapshot. Channel jobs run on separate schedules, so the latest import time and latest version/ref sit above the compact table. If the newest run failed, the RTT columns keep the last usable passing sample and the Status column names the current failure.

<!-- latest-main:start -->

Latest imported channel run: `2026-06-01T08:02:48.749Z` · latest `2026.5.31` / `6627b4fbdd`

| Channel | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| Telegram | `1,023ms` | `2,728ms` | `136MB` | `136MB` | ok |
| Discord | `1,885ms` | `2,024ms` | `940MB` | `1,104MB` | ok |
| Slack | `3,156ms` | `4,497ms` | `942MB` | `970MB` | ok |
| WhatsApp | `3,082ms` | `3,854ms` | `987MB` | `1,008MB` | ok |

<!-- latest-main:end -->

Operator notes: [Data imports and layout](docs/data-imports.md) · [Channel expansion](docs/channel-expansion.md).

## Surface Dashboard

RPC and Control UI rows use the same normalized RTT shape as channel rows, but they are not transport channels. Native RPC rows come from direct loopback Gateway WebSocket calls in `rpc-gateway-smoke`; historical RPC backfills stay marked as channel-derived continuity rows. Control UI rows come from mocked browser/Gateway flows with explicit `control-ui.*` performance events or scenario RTT measurements.

<!-- surface-latest:start -->

Latest imported surface run: `2026-06-01T08:17:17.576Z` · latest `2026.5.31` / `e680604577`

| Surface | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| RPC | `11ms` | `13ms` | `174MB` | `182MB` | ok: gateway RPC |
| Control UI | `398ms` | `414ms` | `450MB` | `1,094MB` | ok: browser/Gateway |

<!-- surface-latest:end -->

## Release Coverage Matrix

Version-by-version RTT coverage for release canaries and non-channel surfaces. The matrix, per-channel release tables, and surface coverage table follow the same imported release-version axis from `2026.4.24` onward. A `-` cell means no row has been imported for that target/version yet; `n/a` means the release predates the channel harness or has a known protocol gap; `blocked`, `timeout`, `logged out`, and `auth 401` name imported failed runs without usable RTT.

Use this as release coverage and regression signal, not a channel speed ranking. Channel cells show RTT `p50` for that channel's release scenario; surface cells show RTT `p50` for that surface's imported measurement or backfill. `p50 σ` is the standard deviation across populated target p50 values for that release. Older Telegram/Discord-only history remains in the per-channel release tables below.

<!-- release-coverage:start -->

Latest imported release coverage run: `2026-06-01T01:44:48.382Z`

| Version | p50 σ | Telegram | Discord | Slack | WhatsApp | RPC | Control UI |
|---|---:|---:|---:|---:|---:|---:|---:|
| `2026.5.31-beta.3` | `886ms` | `998ms` | `2,030ms` | `3,353ms` | `3,293ms` | `2,035ms` | - |
| `2026.5.31-beta.2` | `845ms` | `993ms` | `1,829ms` | `3,355ms` | `2,977ms` | `2,590ms` | - |
| `2026.5.31-beta.1` | `900ms` | `1,003ms` | `1,779ms` | `3,251ms` | `3,113ms` | `3,103ms` | - |
| `2026.5.30-beta.1` | `962ms` | `998ms` | `3,344ms` | `3,500ms` | `3,446ms` | `3,291ms` | - |
| `2026.5.28` | `803ms` | `993ms` | `2,728ms` | `3,143ms` | `3,140ms` | `2,815ms` | - |
| `2026.5.28-beta.4` | `804ms` | `994ms` | `2,665ms` | `3,183ms` | `3,133ms` | `2,785ms` | - |
| `2026.5.28-beta.3` | `720ms` | `1,165ms` | `2,709ms` | `2,900ms` | `3,205ms` | `2,869ms` | - |
| `2026.5.28-beta.1` | `796ms` | `991ms` | `2,280ms` | `3,223ms` | `3,061ms` | `2,654ms` | - |
| `2026.5.27` | `1,106ms` | `1,487ms` | `4,340ms` | `4,427ms` | `3,630ms` | `4,247ms` | - |
| `2026.5.27-beta.1` | `81ms` | fail | `4,308ms` | `4,410ms` | `4,181ms` | `4,306ms` | - |
| `2026.5.26` | `1,396ms` | `1,017ms` | `4,649ms` | `4,432ms` | `4,486ms` | `4,437ms` | - |
| `2026.5.26-beta.2` | `1,413ms` | `1,050ms` | `4,682ms` | `4,525ms` | `4,584ms` | `4,527ms` | - |
| `2026.5.26-beta.1` | `1,274ms` | `1,417ms` | `4,557ms` | `4,934ms` | `4,102ms` | `4,535ms` | - |
| `2026.5.25-beta.1` | `1,238ms` | `1,348ms` | `4,502ms` | `4,603ms` | `4,126ms` | `4,441ms` | - |
| `2026.5.24-beta.2` | `3,739ms` | `2,927ms` | `14,617ms` | `8,610ms` | `10,153ms` | `9,066ms` | - |
| `2026.5.24-beta.1` | `5,091ms` | `2,318ms` | `17,943ms` | `7,152ms` | `8,215ms` | `7,794ms` | - |
| `2026.5.22` | `5,133ms` | `2,281ms` | `17,987ms` | `6,835ms` | `8,301ms` | `7,905ms` | - |
| `2026.5.22-beta.1` | `4,977ms` | `2,265ms` | `17,559ms` | `7,071ms` | `8,090ms` | `7,650ms` | - |
| `2026.5.20` | `2,096ms` | `1,004ms` | `5,189ms` | `4,957ms` | `7,506ms` | `5,082ms` | - |
| `2026.5.20-beta.2` | `2,425ms` | `1,002ms` | `7,346ms` | `5,813ms` | `7,515ms` | `6,845ms` | - |
| `2026.5.20-beta.1` | `2,557ms` | `1,054ms` | `7,047ms` | `4,609ms` | `8,336ms` | `6,814ms` | - |
| `2026.5.19` | `2,235ms` | `1,444ms` | `6,951ms` | `4,727ms` | `7,666ms` | `6,563ms` | - |
| `2026.5.19-beta.2` | `2,487ms` | `1,036ms` | `7,279ms` | `4,713ms` | `7,769ms` | `6,938ms` | - |
| `2026.5.19-beta.1` | `2,113ms` | `1,224ms` | `5,092ms` | `4,551ms` | `7,852ms` | `5,071ms` | - |
| `2026.5.18` | `2,473ms` | `1,061ms` | `7,318ms` | `4,253ms` | `7,618ms` | `6,758ms` | - |
| `2026.5.18-beta.1` | `2,541ms` | `1,017ms` | `5,957ms` | blocked | `7,875ms` | `5,977ms` | - |
| `2026.5.16-beta.7` | `2,190ms` | `1,583ms` | `7,307ms` | `4,704ms` | `7,607ms` | `6,055ms` | - |
| `2026.5.16-beta.6` | `2,216ms` | `1,417ms` | `7,844ms` | `4,719ms` | `6,886ms` | `4,732ms` | - |
| `2026.5.16-beta.5` | `2,287ms` | `1,386ms` | timeout | `4,703ms` | `7,853ms` | `4,740ms` | - |
| `2026.5.16-beta.4` | `8,826ms` | `1,221ms` | `26,263ms` | `4,255ms` | `6,888ms` | `6,975ms` | - |
| `2026.5.16-beta.3` | `8,856ms` | `1,112ms` | `26,771ms` | `4,690ms` | `8,644ms` | `8,644ms` | - |
| `2026.5.16-beta.2` | `8,873ms` | `1,050ms` | `26,639ms` | `4,751ms` | `8,377ms` | `7,308ms` | - |
| `2026.5.16-beta.1` | `6,908ms` | `1,196ms` | `21,140ms` | `4,205ms` | `6,714ms` | `6,087ms` | - |
| `2026.5.14-beta.2` | `6,979ms` | `990ms` | `21,273ms` | `4,621ms` | `6,439ms` | `5,873ms` | - |
| `2026.5.14-beta.1` | `7,300ms` | `1,004ms` | `22,035ms` | `4,211ms` | `6,636ms` | `5,929ms` | - |
| `2026.5.12` | `6,569ms` | `2,858ms` | `20,640ms` | `4,170ms` | `7,035ms` | `4,239ms` | - |
| `2026.5.9-beta.1` | `5,121ms` | `2,517ms` | `16,759ms` | `4,488ms` | `4,971ms` | `4,565ms` | - |
| `2026.5.7` | `6,315ms` | `3,499ms` | `18,948ms` | `4,877ms` | n/a | `4,891ms` | - |
| `2026.5.6` | `5,906ms` | `3,497ms` | `18,001ms` | `4,876ms` | n/a | `4,905ms` | - |
| `2026.5.4` | `6,249ms` | `3,504ms` | `18,937ms` | `5,121ms` | n/a | `5,135ms` | - |
| `2026.5.3` | `631ms` | `3,505ms` | n/a | `4,980ms` | n/a | `3,840ms` | - |
| `2026.5.2` | `7,184ms` | `3,501ms` | `20,146ms` | n/a | n/a | `16,769ms` | - |
| `2026.4.29` | `0ms` | `17,936ms` | n/a | n/a | n/a | `17,936ms` | - |
| `2026.4.27` | `13,388ms` | `4,639ms` | `36,858ms` | n/a | n/a | `15,458ms` | - |
| `2026.4.26` | `11,307ms` | `5,880ms` | `32,689ms` | n/a | n/a | `25,305ms` | - |
| `2026.4.25` | `17,086ms` | `7,508ms` | `49,357ms` | n/a | n/a | `27,988ms` | - |
| `2026.4.24` | `13,298ms` | `2,679ms` | `33,328ms` | n/a | n/a | `8,454ms` | - |

<!-- release-coverage:end -->

## Surface Release Coverage

The surface matrix tracks non-channel coverage separately so channel regressions do not get mixed with Gateway RPC or Control UI browser timing. Native RPC rows are preferred over backfilled channel-observed rows for the same version; Control UI cells require explicit surface measurements.

<!-- surface-release-coverage:start -->

Latest imported surface run: `2026-05-31T20:54:46.859Z`

| Version | RPC | Control UI |
|---|---:|---:|
| `2026.5.31-beta.3` | `2,035ms` | - |
| `2026.5.31-beta.2` | `2,590ms` | - |
| `2026.5.31-beta.1` | `3,103ms` | - |
| `2026.5.30-beta.1` | `3,291ms` | - |
| `2026.5.28` | `2,815ms` | - |
| `2026.5.28-beta.4` | `2,785ms` | - |
| `2026.5.28-beta.3` | `2,869ms` | - |
| `2026.5.28-beta.1` | `2,654ms` | - |
| `2026.5.27` | `4,247ms` | - |
| `2026.5.27-beta.1` | `4,306ms` | - |
| `2026.5.26` | `4,437ms` | - |
| `2026.5.26-beta.2` | `4,527ms` | - |
| `2026.5.26-beta.1` | `4,535ms` | - |
| `2026.5.25-beta.1` | `4,441ms` | - |
| `2026.5.24-beta.2` | `9,066ms` | - |
| `2026.5.24-beta.1` | `7,794ms` | - |
| `2026.5.22` | `7,905ms` | - |
| `2026.5.22-beta.1` | `7,650ms` | - |
| `2026.5.20` | `5,082ms` | - |
| `2026.5.20-beta.2` | `6,845ms` | - |
| `2026.5.20-beta.1` | `6,814ms` | - |
| `2026.5.19` | `6,563ms` | - |
| `2026.5.19-beta.2` | `6,938ms` | - |
| `2026.5.19-beta.1` | `5,071ms` | - |
| `2026.5.18` | `6,758ms` | - |
| `2026.5.18-beta.1` | `5,977ms` | - |
| `2026.5.16-beta.7` | `6,055ms` | - |
| `2026.5.16-beta.6` | `4,732ms` | - |
| `2026.5.16-beta.5` | `4,740ms` | - |
| `2026.5.16-beta.4` | `6,975ms` | - |
| `2026.5.16-beta.3` | `8,644ms` | - |
| `2026.5.16-beta.2` | `7,308ms` | - |
| `2026.5.16-beta.1` | `6,087ms` | - |
| `2026.5.14-beta.2` | `5,873ms` | - |
| `2026.5.14-beta.1` | `5,929ms` | - |
| `2026.5.12` | `4,239ms` | - |
| `2026.5.9-beta.1` | `4,565ms` | - |
| `2026.5.7` | `4,891ms` | - |
| `2026.5.6` | `4,905ms` | - |
| `2026.5.4` | `5,135ms` | - |
| `2026.5.3` | `3,840ms` | - |
| `2026.5.2` | `16,769ms` | - |
| `2026.4.29` | `17,936ms` | - |
| `2026.4.27` | `15,458ms` | - |
| `2026.4.26` | `25,305ms` | - |
| `2026.4.25` | `27,988ms` | - |
| `2026.4.24` | `8,454ms` | - |

<!-- surface-release-coverage:end -->

## Telegram Release Runs

Telegram release runs use the OpenClaw repo black-box harness on Blacksmith with `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target normal-reply samples, a 240s canary timeout, and a 30s per-sample timeout.

The system under test is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

<!-- release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| `2026.5.31-beta.3` | `998ms` | `2,020ms` | `148MB` | `148MB` | ok |
| `2026.5.31-beta.2` | `993ms` | `2,027ms` | `147MB` | `147MB` | ok |
| `2026.5.31-beta.1` | `1,003ms` | `1,980ms` | `148MB` | `148MB` | ok |
| `2026.5.30-beta.1` | `998ms` | `2,051ms` | `147MB` | `147MB` | ok |
| `2026.5.28` | `993ms` | `2,022ms` | `149MB` | `149MB` | ok |
| `2026.5.28-beta.4` | `994ms` | `2,041ms` | `147MB` | `147MB` | ok |
| `2026.5.28-beta.3` | `1,165ms` | `2,031ms` | `148MB` | `148MB` | ok |
| `2026.5.28-beta.1` | `991ms` | `1,996ms` | `147MB` | `147MB` | ok |
| `2026.5.27` | `1,487ms` | `2,550ms` | `157MB` | `157MB` | ok |
| `2026.5.27-beta.1` | - | - | `156MB` | `156MB` | failed |
| `2026.5.26` | `1,017ms` | `2,035ms` | `155MB` | `155MB` | ok |
| `2026.5.26-beta.2` | `1,050ms` | `2,099ms` | `146MB` | `146MB` | ok |
| `2026.5.26-beta.1` | `1,417ms` | `2,406ms` | `147MB` | `147MB` | ok |
| `2026.5.25-beta.1` | `1,348ms` | `1,836ms` | `146MB` | `146MB` | ok |
| `2026.5.24-beta.2` | `2,927ms` | `3,770ms` | `147MB` | `147MB` | ok |
| `2026.5.24-beta.1` | `2,318ms` | `2,921ms` | `147MB` | `147MB` | ok |
| `2026.5.22` | `2,281ms` | `3,294ms` | `149MB` | `149MB` | ok |
| `2026.5.22-beta.1` | `2,265ms` | `2,840ms` | `147MB` | `147MB` | ok |
| `2026.5.20` | `1,004ms` | `2,344ms` | `147MB` | `147MB` | ok |
| `2026.5.20-beta.2` | `1,002ms` | `2,398ms` | `146MB` | `146MB` | ok |
| `2026.5.20-beta.1` | `1,054ms` | `12,248ms` | `139MB` | `139MB` | ok |
| `2026.5.19` | `1,444ms` | `2,346ms` | `145MB` | `145MB` | ok |
| `2026.5.19-beta.2` | `1,036ms` | `2,404ms` | `145MB` | `145MB` | ok |
| `2026.5.19-beta.1` | `1,224ms` | `2,703ms` | `145MB` | `145MB` | ok |
| `2026.5.18` | `1,061ms` | `12,713ms` | `140MB` | `140MB` | ok |
| `2026.5.18-beta.1` | `1,017ms` | `2,421ms` | `145MB` | `145MB` | ok |
| `2026.5.16-beta.7` | `1,583ms` | `2,601ms` | `147MB` | `147MB` | ok |
| `2026.5.16-beta.6` | `1,417ms` | `13,429ms` | `135MB` | `135MB` | ok |
| `2026.5.16-beta.5` | `1,386ms` | `3,823ms` | `145MB` | `145MB` | ok |
| `2026.5.16-beta.4` | `1,221ms` | `2,077ms` | `145MB` | `145MB` | ok |
| `2026.5.16-beta.3` | `1,112ms` | `2,172ms` | `145MB` | `145MB` | ok |
| `2026.5.16-beta.2` | `1,050ms` | `2,002ms` | `145MB` | `145MB` | ok |
| `2026.5.16-beta.1` | `1,196ms` | `1,969ms` | `145MB` | `145MB` | ok |
| `2026.5.14-beta.2` | `990ms` | `1,745ms` | `145MB` | `145MB` | ok |
| `2026.5.14-beta.1` | `1,004ms` | `3,915ms` | `146MB` | `146MB` | ok |
| `2026.5.12` | `2,858ms` | `23,061ms` | `135MB` | `135MB` | ok |
| `2026.5.9-beta.1` | `2,517ms` | `14,692ms` | `134MB` | `134MB` | ok |
| `2026.5.7` | `3,499ms` | `21,847ms` | `134MB` | `134MB` | ok |
| `2026.5.6` | `3,497ms` | `16,762ms` | `135MB` | `135MB` | ok |
| `2026.5.4` | `3,504ms` | `16,673ms` | `134MB` | `134MB` | ok |
| `2026.5.3` | `3,505ms` | `16,741ms` | `136MB` | `136MB` | ok |
| `2026.5.2` | `3,501ms` | `16,759ms` | `135MB` | `135MB` | ok |
| `2026.4.29` | `17,936ms` | `24,517ms` | n/a | n/a | ok |
| `2026.4.27` | `4,639ms` | `13,664ms` | `134MB` | `134MB` | ok |
| `2026.4.26` | `5,880ms` | `18,610ms` | `135MB` | `135MB` | ok |
| `2026.4.25` | `7,508ms` | `27,982ms` | `146MB` | `146MB` | ok |
| `2026.4.24` | `2,679ms` | `13,451ms` | `133MB` | `133MB` | ok |
| `2026.4.23` | `2,507ms` | `14,671ms` | `134MB` | `134MB` | ok |
| `2026.4.22` | `2,497ms` | `14,847ms` | `135MB` | `135MB` | ok |
| `2026.4.21` | `3,502ms` | `16,828ms` | `146MB` | `146MB` | ok |
| `2026.4.20` | `3,504ms` | `16,796ms` | `136MB` | `136MB` | ok |
| `2026.4.15` | `3,503ms` | `16,809ms` | `135MB` | `135MB` | ok |

<!-- release-sweep:end -->

## Discord Release Runs

Discord release runs use the OpenClaw Discord QA harness with `mock-openai`, scenario `discord-canary`, and Convex-managed CI credentials. Imported RTT requires a scenario RTT measurement or observed-message timestamps; whole-command duration is retained only as diagnostic metadata.

<!-- discord-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| `2026.5.31-beta.3` | `2,030ms` | `2,136ms` | `887MB` | `1,094MB` | ok |
| `2026.5.31-beta.2` | `1,829ms` | `1,999ms` | `895MB` | `1,106MB` | ok |
| `2026.5.31-beta.1` | `1,779ms` | `1,966ms` | `889MB` | `1,053MB` | ok |
| `2026.5.30-beta.1` | `3,344ms` | `4,956ms` | `1,055MB` | `1,106MB` | ok |
| `2026.5.28` | `2,728ms` | `2,967ms` | `958MB` | `967MB` | ok |
| `2026.5.28-beta.4` | `2,665ms` | `2,827ms` | `955MB` | `1,029MB` | ok |
| `2026.5.28-beta.3` | `2,709ms` | `6,026ms` | `945MB` | `1,012MB` | failed: reply matched |
| `2026.5.28-beta.1` | `2,280ms` | `2,450ms` | `892MB` | `1,003MB` | ok |
| `2026.5.27` | `4,340ms` | `4,709ms` | `804MB` | `818MB` | ok |
| `2026.5.27-beta.1` | `4,308ms` | `4,603ms` | `806MB` | `840MB` | ok |
| `2026.5.26` | `4,649ms` | `5,155ms` | `840MB` | `854MB` | ok |
| `2026.5.26-beta.2` | `4,682ms` | `4,991ms` | `849MB` | `857MB` | ok |
| `2026.5.26-beta.1` | `4,557ms` | `4,948ms` | `820MB` | `838MB` | ok |
| `2026.5.25-beta.1` | `4,502ms` | `4,630ms` | `809MB` | `819MB` | ok |
| `2026.5.24-beta.2` | `14,617ms` | `15,587ms` | `808MB` | `886MB` | ok |
| `2026.5.24-beta.1` | `17,943ms` | `19,372ms` | `803MB` | `855MB` | ok |
| `2026.5.22` | `17,987ms` | `18,731ms` | `782MB` | `805MB` | ok |
| `2026.5.22-beta.1` | `17,559ms` | `18,046ms` | `782MB` | `803MB` | ok |
| `2026.5.20` | `5,189ms` | `5,473ms` | `757MB` | `766MB` | ok |
| `2026.5.20-beta.2` | `7,346ms` | `7,571ms` | `754MB` | `762MB` | ok |
| `2026.5.20-beta.1` | `7,047ms` | `7,412ms` | `749MB` | `766MB` | ok |
| `2026.5.19` | `6,951ms` | `7,238ms` | `746MB` | `778MB` | ok |
| `2026.5.19-beta.2` | `7,279ms` | `7,506ms` | `745MB` | `789MB` | ok |
| `2026.5.19-beta.1` | `5,092ms` | `5,294ms` | `742MB` | `755MB` | ok |
| `2026.5.18` | `7,318ms` | `7,657ms` | `768MB` | `783MB` | ok |
| `2026.5.18-beta.1` | `5,957ms` | `6,083ms` | `770MB` | `783MB` | ok |
| `2026.5.16-beta.7` | `7,307ms` | `7,792ms` | `766MB` | `782MB` | ok |
| `2026.5.16-beta.6` | `7,844ms` | `7,844ms` | `768MB` | `779MB` | timeout |
| `2026.5.16-beta.5` | - | - | `768MB` | `781MB` | timeout |
| `2026.5.16-beta.4` | `26,263ms` | `28,304ms` | `779MB` | `815MB` | ok |
| `2026.5.16-beta.3` | `26,771ms` | `28,550ms` | `812MB` | `825MB` | ok |
| `2026.5.16-beta.2` | `26,639ms` | `27,767ms` | `808MB` | `820MB` | ok |
| `2026.5.16-beta.1` | `21,140ms` | `22,665ms` | `804MB` | `816MB` | ok |
| `2026.5.14-beta.2` | `21,273ms` | `21,924ms` | `793MB` | `816MB` | ok |
| `2026.5.14-beta.1` | `22,035ms` | `22,796ms` | `810MB` | `848MB` | ok |
| `2026.5.12` | `20,640ms` | `22,622ms` | `792MB` | `810MB` | ok |
| `2026.5.9-beta.1` | `16,759ms` | `18,006ms` | `775MB` | `803MB` | ok |
| `2026.5.7` | `18,948ms` | `22,954ms` | `792MB` | `823MB` | ok |
| `2026.5.6` | `18,001ms` | `18,832ms` | `797MB` | `807MB` | ok |
| `2026.5.4` | `18,937ms` | `19,896ms` | `794MB` | `810MB` | ok |
| `2026.5.3` | - | - | - | - | not supported: release omits Discord observed-message timing data |
| `2026.5.2` | `20,146ms` | `21,604ms` | `719MB` | `724MB` | ok |
| `2026.4.29` | - | - | - | - | not supported: release omits Discord observed-message timing data |
| `2026.4.27` | `36,858ms` | `38,863ms` | `842MB` | `961MB` | ok |
| `2026.4.26` | `32,689ms` | `34,092ms` | `762MB` | `779MB` | ok |
| `2026.4.25` | `49,357ms` | `52,963ms` | `869MB` | `884MB` | ok |
| `2026.4.24` | `33,328ms` | `34,734ms` | `767MB` | `842MB` | ok |

<!-- discord-release-sweep:end -->

## Slack Release Runs

Slack release runs use the OpenClaw Slack QA harness with `mock-openai`, scenario `slack-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- slack-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| `2026.5.31-beta.3` | `3,353ms` | `4,608ms` | `939MB` | `970MB` | ok |
| `2026.5.31-beta.2` | `3,355ms` | `4,979ms` | `946MB` | `968MB` | ok |
| `2026.5.31-beta.1` | `3,251ms` | `4,506ms` | `947MB` | `974MB` | ok |
| `2026.5.30-beta.1` | `3,500ms` | `4,583ms` | `959MB` | `990MB` | ok |
| `2026.5.28` | `3,143ms` | `4,390ms` | `917MB` | `937MB` | ok |
| `2026.5.28-beta.4` | `3,183ms` | `4,488ms` | `896MB` | `930MB` | ok |
| `2026.5.28-beta.3` | `2,900ms` | `4,207ms` | `913MB` | `999MB` | ok |
| `2026.5.28-beta.1` | `3,223ms` | `4,570ms` | `906MB` | `935MB` | ok |
| `2026.5.27` | `4,427ms` | `4,655ms` | `781MB` | `796MB` | ok |
| `2026.5.27-beta.1` | `4,410ms` | `5,969ms` | `716MB` | `837MB` | ok |
| `2026.5.26` | `4,432ms` | `4,665ms` | `725MB` | `814MB` | ok |
| `2026.5.26-beta.2` | `4,525ms` | `5,840ms` | `725MB` | `813MB` | ok |
| `2026.5.26-beta.1` | `4,934ms` | `4,964ms` | `741MB` | `770MB` | ok |
| `2026.5.25-beta.1` | `4,603ms` | `6,077ms` | `723MB` | `759MB` | ok |
| `2026.5.24-beta.2` | `8,610ms` | `9,698ms` | `705MB` | `724MB` | ok |
| `2026.5.24-beta.1` | `7,152ms` | `8,406ms` | `699MB` | `753MB` | ok |
| `2026.5.22` | `6,835ms` | `8,094ms` | `742MB` | `764MB` | ok |
| `2026.5.22-beta.1` | `7,071ms` | `8,384ms` | `753MB` | `774MB` | ok |
| `2026.5.20` | `4,957ms` | `6,447ms` | `727MB` | `773MB` | ok |
| `2026.5.20-beta.2` | `5,813ms` | `5,978ms` | `685MB` | `804MB` | ok |
| `2026.5.20-beta.1` | `4,609ms` | `6,020ms` | `706MB` | `768MB` | ok |
| `2026.5.19` | `4,727ms` | `6,190ms` | `711MB` | `747MB` | ok |
| `2026.5.19-beta.2` | `4,713ms` | `5,988ms` | `713MB` | `751MB` | ok |
| `2026.5.19-beta.1` | `4,551ms` | `5,896ms` | `718MB` | `754MB` | ok |
| `2026.5.18` | `4,253ms` | `5,549ms` | `710MB` | `767MB` | ok |
| `2026.5.18-beta.1` | - | - | `569MB` | `569MB` | blocked: credential pool exhausted |
| `2026.5.16-beta.7` | `4,704ms` | `6,118ms` | `699MB` | `762MB` | ok |
| `2026.5.16-beta.6` | `4,719ms` | `5,051ms` | `724MB` | `760MB` | ok |
| `2026.5.16-beta.5` | `4,703ms` | `4,791ms` | `725MB` | `1,008MB` | partial: 4/5 samples passed; timeout |
| `2026.5.16-beta.4` | `4,255ms` | `5,484ms` | `671MB` | `709MB` | ok |
| `2026.5.16-beta.3` | `4,690ms` | `5,929ms` | `673MB` | `723MB` | ok |
| `2026.5.16-beta.2` | `4,751ms` | `5,868ms` | `672MB` | `696MB` | ok |
| `2026.5.16-beta.1` | `4,205ms` | `4,459ms` | `659MB` | `691MB` | ok |
| `2026.5.14-beta.2` | `4,621ms` | `5,344ms` | `671MB` | `722MB` | ok |
| `2026.5.14-beta.1` | `4,211ms` | `4,447ms` | `681MB` | `736MB` | ok |
| `2026.5.12` | `4,170ms` | `4,381ms` | `708MB` | `717MB` | ok |
| `2026.5.9-beta.1` | `4,488ms` | `4,708ms` | `621MB` | `626MB` | ok |
| `2026.5.7` | `4,877ms` | `4,928ms` | `643MB` | `681MB` | ok |
| `2026.5.6` | `4,876ms` | `5,564ms` | `649MB` | `671MB` | ok |
| `2026.5.4` | `5,121ms` | `5,482ms` | `651MB` | `659MB` | ok |
| `2026.5.3` | `4,980ms` | `5,146ms` | `628MB` | `631MB` | ok |
| `2026.5.2` | - | - | - | - | not supported: release predates the Slack QA canary |
| `2026.4.29` | - | - | - | - | not supported: release predates the Slack QA canary |
| `2026.4.27` | - | - | - | - | not supported: release predates the Slack QA canary |
| `2026.4.26` | - | - | - | - | not supported: release predates the Slack QA canary |
| `2026.4.25` | - | - | - | - | not supported: release predates the Slack QA canary |
| `2026.4.24` | - | - | - | - | not supported: release predates the Slack QA canary |

<!-- slack-release-sweep:end -->

## WhatsApp Release Runs

WhatsApp release runs use the OpenClaw WhatsApp QA harness with `mock-openai`, scenario `whatsapp-canary`, and Convex-managed CI credentials. RSS includes the QA-lab sample process.

<!-- whatsapp-release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| `2026.5.31-beta.3` | `3,293ms` | `4,031ms` | `980MB` | `1,015MB` | ok |
| `2026.5.31-beta.2` | `2,977ms` | `3,821ms` | `985MB` | `1,009MB` | ok |
| `2026.5.31-beta.1` | `3,113ms` | `3,780ms` | `982MB` | `1,007MB` | ok |
| `2026.5.30-beta.1` | `3,446ms` | `3,959ms` | `990MB` | `1,021MB` | ok |
| `2026.5.28` | `3,140ms` | `3,790ms` | `953MB` | `985MB` | ok |
| `2026.5.28-beta.4` | `3,133ms` | `3,906ms` | `938MB` | `990MB` | ok |
| `2026.5.28-beta.3` | `3,205ms` | `4,426ms` | `950MB` | `1,008MB` | ok |
| `2026.5.28-beta.1` | `3,061ms` | `4,186ms` | `941MB` | `966MB` | ok |
| `2026.5.27` | `3,630ms` | `5,209ms` | `746MB` | `754MB` | ok |
| `2026.5.27-beta.1` | `4,181ms` | `5,411ms` | `748MB` | `762MB` | ok |
| `2026.5.26` | `4,486ms` | `6,203ms` | `752MB` | `783MB` | ok |
| `2026.5.26-beta.2` | `4,584ms` | `5,543ms` | `759MB` | `778MB` | ok |
| `2026.5.26-beta.1` | `4,102ms` | `5,202ms` | `741MB` | `758MB` | ok |
| `2026.5.25-beta.1` | `4,126ms` | `5,055ms` | `741MB` | `785MB` | ok |
| `2026.5.24-beta.2` | `10,153ms` | `12,914ms` | `725MB` | `752MB` | ok |
| `2026.5.24-beta.1` | `8,215ms` | `9,664ms` | `725MB` | `740MB` | ok |
| `2026.5.22` | `8,301ms` | `9,291ms` | `702MB` | `777MB` | ok |
| `2026.5.22-beta.1` | `8,090ms` | `8,992ms` | `736MB` | `783MB` | ok |
| `2026.5.20` | `7,506ms` | `8,789ms` | `924MB` | `1,582MB` | ok |
| `2026.5.20-beta.2` | `7,515ms` | `9,050ms` | `1,074MB` | `1,579MB` | ok |
| `2026.5.20-beta.1` | `8,336ms` | `9,779ms` | `1,076MB` | `1,591MB` | ok |
| `2026.5.19` | `7,666ms` | `8,191ms` | `887MB` | `1,524MB` | ok |
| `2026.5.19-beta.2` | `7,769ms` | `8,881ms` | `901MB` | `1,115MB` | ok |
| `2026.5.19-beta.1` | `7,852ms` | `9,179ms` | `835MB` | `990MB` | ok |
| `2026.5.18` | `7,618ms` | `8,715ms` | `923MB` | `1,549MB` | ok |
| `2026.5.18-beta.1` | `7,875ms` | `8,927ms` | `876MB` | `1,592MB` | ok |
| `2026.5.16-beta.7` | `7,607ms` | `9,241ms` | `838MB` | `2,714MB` | partial: 13/14 samples passed; blocked: credential pool exhausted |
| `2026.5.16-beta.6` | `6,886ms` | `7,819ms` | `891MB` | `1,368MB` | ok |
| `2026.5.16-beta.5` | `7,853ms` | `8,684ms` | `903MB` | `1,546MB` | ok |
| `2026.5.16-beta.4` | `6,888ms` | `8,290ms` | `868MB` | `1,599MB` | ok |
| `2026.5.16-beta.3` | `8,644ms` | `9,572ms` | `894MB` | `1,593MB` | ok |
| `2026.5.16-beta.2` | `8,377ms` | `10,642ms` | `1,006MB` | `1,495MB` | ok |
| `2026.5.16-beta.1` | `6,714ms` | `7,367ms` | `1,487MB` | `1,521MB` | ok |
| `2026.5.14-beta.2` | `6,439ms` | `7,602ms` | `740MB` | `872MB` | ok |
| `2026.5.14-beta.1` | `6,636ms` | `7,158ms` | `859MB` | `906MB` | ok |
| `2026.5.12` | `7,035ms` | `8,106ms` | `857MB` | `893MB` | ok |
| `2026.5.9-beta.1` | `4,971ms` | `6,231ms` | `851MB` | `879MB` | ok |
| `2026.5.7` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.5.6` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.5.4` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.5.3` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.5.2` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.4.29` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.4.27` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.4.26` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.4.25` | - | - | - | - | not supported: release predates the WhatsApp QA canary |
| `2026.4.24` | - | - | - | - | not supported: release predates the WhatsApp QA canary |

<!-- whatsapp-release-sweep:end -->
