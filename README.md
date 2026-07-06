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

Latest imported channel run: `2026-07-06T08:21:02.000Z` · latest `2026.6.11` / `8d1668c441`

| Channel | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| Telegram | `1,012ms` | `1,995ms` | `136MB` | `136MB` | stale: latest failed; showing last pass (failed) |
| Discord | `1,958ms` | `2,184ms` | `1,073MB` | `1,108MB` | ok |
| Slack | `3,568ms` | `3,568ms` | `860MB` | `860MB` | stale: latest failed; showing last pass (failed) |
| WhatsApp | `3,143ms` | `3,638ms` | `1,049MB` | `1,055MB` | stale: latest failed; showing last pass (failed) |

<!-- latest-main:end -->

Operator notes: [Data imports and layout](docs/data-imports.md) · [Channel expansion](docs/channel-expansion.md).

## Surface Dashboard

RPC and Control UI rows use the same normalized RTT shape as channel rows, but they are not transport channels. Native RPC rows come from direct loopback Gateway WebSocket calls in `rpc-gateway-smoke`; historical RPC backfills stay marked as channel-derived continuity rows. Control UI rows come from mocked browser/Gateway flows with explicit `control-ui.*` performance events or scenario RTT measurements.

<!-- surface-latest:start -->

Latest imported surface run: `2026-07-06T08:01:21.778Z` · latest `2026.6.11` / `e53131ea1c`

| Surface | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| RPC | `6ms` | `8ms` | `173MB` | `184MB` | ok: gateway RPC |
| Control UI | `267ms` | `294ms` | `454MB` | `949MB` | ok: browser/Gateway |

<!-- surface-latest:end -->

## Release Coverage Matrix

Version-by-version RTT coverage for release canaries and non-channel surfaces. The matrix, per-channel release tables, and surface coverage table follow the same imported release-version axis from `2026.4.24` onward. A `-` cell means no row has been imported for that target/version yet; `n/a` means the release predates that target's harness or has a known protocol/collection gap; `blocked`, `timeout`, `logged out`, and `auth 401` name imported failed runs without usable RTT.

Use this as release coverage and regression signal, not a channel speed ranking. Channel cells show RTT `p50` for that channel's release scenario; surface cells show RTT `p50` for that surface's imported measurement or backfill. `p50 σ` is the standard deviation across populated target p50 values for that release. Older Telegram/Discord-only history remains in the per-channel release tables below.

<!-- release-coverage:start -->

Latest imported release coverage run: `2026-07-06T09:01:07.407Z`

| Version | p50 σ | Telegram | Discord | Slack | WhatsApp | RPC | Control UI |
|---|---:|---:|---:|---:|---:|---:|---:|
| `2026.7.1-beta.2` | `826ms` | `1,992ms` | - | fail | - | - | `341ms` |
| `2026.7.1-beta.1` | `1,185ms` | `1,903ms` | `1,889ms` | `3,549ms` | - | `3,549ms` | `407ms` |
| `2026.6.11` | `939ms` | `999ms` | `1,728ms` | `3,213ms` | - | `1,743ms` | `413ms` |
| `2026.6.11-beta.2` | `1,123ms` | `988ms` | `1,759ms` | `3,174ms` | - | `3,174ms` | `413ms` |
| `2026.6.11-beta.1` | `1,006ms` | `1,850ms` | `1,876ms` | `3,120ms` | - | `3,120ms` | `407ms` |
| `2026.6.10` | `1,710ms` | `1,961ms` | `1,790ms` | `4,698ms` | - | `4,698ms` | `407ms` |
| `2026.6.10-beta.2` | `1,073ms` | `1,945ms` | `1,795ms` | `3,275ms` | - | `3,275ms` | `402ms` |
| `2026.6.10-beta.1` | `983ms` | `1,955ms` | `1,971ms` | `3,518ms` | fail | `1,984ms` | `411ms` |
| `2026.6.9` | `790ms` | `1,974ms` | `2,166ms` | fail | fail | - | `403ms` |
| `2026.6.9-beta.1` | `788ms` | `1,970ms` | `2,167ms` | fail | fail | - | `405ms` |
| `2026.6.8` | `835ms` | `1,984ms` | `2,340ms` | fail | fail | - | `417ms` |
| `2026.6.8-beta.2` | `763ms` | `1,927ms` | `2,016ms` | fail | fail | - | `354ms` |
| `2026.6.8-beta.1` | `734ms` | `1,971ms` | `2,075ms` | fail | fail | `2,075ms` | `349ms` |
| `2026.6.7-beta.1` | `763ms` | `1,003ms` | `2,107ms` | fail | fail | `2,107ms` | `316ms` |
| `2026.6.6` | `1,010ms` | `1,038ms` | `2,249ms` | `3,172ms` | fail | `2,260ms` | `307ms` |
| `2026.6.6-beta.2` | `937ms` | `1,109ms` | `1,929ms` | `3,199ms` | fail | `1,964ms` | `407ms` |
| `2026.6.5` | `1,069ms` | `1,002ms` | `2,068ms` | `3,148ms` | `3,135ms` | `2,636ms` | `308ms` |
| `2026.6.5-beta.6` | `1,011ms` | `993ms` | `1,800ms` | `2,947ms` | `3,125ms` | `2,301ms` | `306ms` |
| `2026.6.5-beta.5` | `946ms` | `1,145ms` | `1,933ms` | `3,130ms` | `2,668ms` | `2,437ms` | `346ms` |
| `2026.6.5-beta.3` | `1,015ms` | `1,013ms` | `1,892ms` | `3,151ms` | `2,869ms` | `2,516ms` | `310ms` |
| `2026.6.5-beta.2` | `1,047ms` | `1,013ms` | `1,837ms` | `3,177ms` | `3,029ms` | `2,593ms` | `333ms` |
| `2026.6.5-beta.1` | `1,021ms` | `1,019ms` | `1,792ms` | `3,192ms` | `3,031ms` | `2,450ms` | `398ms` |
| `2026.6.2-beta.1` | `1,067ms` | `1,001ms` | `1,737ms` | `3,221ms` | `3,020ms` | `2,605ms` | `308ms` |
| `2026.6.1` | `1,161ms` | `1,059ms` | `1,862ms` | `3,190ms` | `3,303ms` | `3,147ms` | `303ms` |
| `2026.6.1-beta.3` | `1,051ms` | `1,089ms` | `1,852ms` | `3,209ms` | `3,147ms` | `2,681ms` | `401ms` |
| `2026.6.1-beta.2` | `764ms` | `988ms` | `1,824ms` | `2,940ms` | `3,072ms` | `2,268ms` | n/a |
| `2026.6.1-beta.1` | `811ms` | `1,009ms` | `1,865ms` | `2,915ms` | `3,267ms` | `2,657ms` | n/a |
| `2026.5.31-beta.4` | `748ms` | `1,139ms` | `1,953ms` | `3,241ms` | `2,957ms` | `2,471ms` | n/a |
| `2026.5.31-beta.3` | `886ms` | `998ms` | `2,030ms` | `3,353ms` | `3,293ms` | `2,035ms` | n/a |
| `2026.5.31-beta.2` | `845ms` | `993ms` | `1,829ms` | `3,355ms` | `2,977ms` | `2,590ms` | n/a |
| `2026.5.31-beta.1` | `900ms` | `1,003ms` | `1,779ms` | `3,251ms` | `3,113ms` | `3,103ms` | n/a |
| `2026.5.30-beta.1` | `962ms` | `998ms` | `3,344ms` | `3,500ms` | `3,446ms` | `3,291ms` | n/a |
| `2026.5.28` | `803ms` | `993ms` | `2,728ms` | `3,143ms` | `3,140ms` | `2,815ms` | n/a |
| `2026.5.28-beta.4` | `804ms` | `994ms` | `2,665ms` | `3,183ms` | `3,133ms` | `2,785ms` | n/a |
| `2026.5.28-beta.3` | `728ms` | `1,165ms` | `2,849ms` | `2,900ms` | `3,205ms` | `2,869ms` | n/a |
| `2026.5.28-beta.1` | `796ms` | `991ms` | `2,280ms` | `3,223ms` | `3,061ms` | `2,654ms` | n/a |
| `2026.5.27` | `1,106ms` | `1,487ms` | `4,340ms` | `4,427ms` | `3,630ms` | `4,247ms` | n/a |
| `2026.5.27-beta.1` | `81ms` | fail | `4,308ms` | `4,410ms` | `4,181ms` | `4,306ms` | n/a |
| `2026.5.26` | `1,396ms` | `1,017ms` | `4,649ms` | `4,432ms` | `4,486ms` | `4,437ms` | n/a |
| `2026.5.26-beta.2` | `1,413ms` | `1,050ms` | `4,682ms` | `4,525ms` | `4,584ms` | `4,527ms` | n/a |
| `2026.5.26-beta.1` | `1,274ms` | `1,417ms` | `4,557ms` | `4,934ms` | `4,102ms` | `4,535ms` | n/a |
| `2026.5.25-beta.1` | `1,238ms` | `1,348ms` | `4,502ms` | `4,603ms` | `4,126ms` | `4,441ms` | n/a |
| `2026.5.24-beta.2` | `3,739ms` | `2,927ms` | `14,617ms` | `8,610ms` | `10,153ms` | `9,066ms` | n/a |
| `2026.5.24-beta.1` | `5,091ms` | `2,318ms` | `17,943ms` | `7,152ms` | `8,215ms` | `7,794ms` | n/a |
| `2026.5.22` | `5,133ms` | `2,281ms` | `17,987ms` | `6,835ms` | `8,301ms` | `7,905ms` | n/a |
| `2026.5.22-beta.1` | `4,977ms` | `2,265ms` | `17,559ms` | `7,071ms` | `8,090ms` | `7,650ms` | n/a |
| `2026.5.20` | `2,096ms` | `1,004ms` | `5,189ms` | `4,957ms` | `7,506ms` | `5,082ms` | n/a |
| `2026.5.20-beta.2` | `2,425ms` | `1,002ms` | `7,346ms` | `5,813ms` | `7,515ms` | `6,845ms` | n/a |
| `2026.5.20-beta.1` | `2,557ms` | `1,054ms` | `7,047ms` | `4,609ms` | `8,336ms` | `6,814ms` | n/a |
| `2026.5.19` | `2,235ms` | `1,444ms` | `6,951ms` | `4,727ms` | `7,666ms` | `6,563ms` | n/a |
| `2026.5.19-beta.2` | `2,487ms` | `1,036ms` | `7,279ms` | `4,713ms` | `7,769ms` | `6,938ms` | n/a |
| `2026.5.19-beta.1` | `2,113ms` | `1,224ms` | `5,092ms` | `4,551ms` | `7,852ms` | `5,071ms` | n/a |
| `2026.5.18` | `2,473ms` | `1,061ms` | `7,318ms` | `4,253ms` | `7,618ms` | `6,758ms` | n/a |
| `2026.5.18-beta.1` | `2,541ms` | `1,017ms` | `5,957ms` | blocked | `7,875ms` | `5,977ms` | n/a |
| `2026.5.16-beta.7` | `2,190ms` | `1,583ms` | `7,307ms` | `4,704ms` | `7,607ms` | `6,055ms` | n/a |
| `2026.5.16-beta.6` | `2,216ms` | `1,417ms` | `7,844ms` | `4,719ms` | `6,886ms` | `4,732ms` | n/a |
| `2026.5.16-beta.5` | `2,287ms` | `1,386ms` | timeout | `4,703ms` | `7,853ms` | `4,740ms` | n/a |
| `2026.5.16-beta.4` | `8,826ms` | `1,221ms` | `26,263ms` | `4,255ms` | `6,888ms` | `6,975ms` | n/a |
| `2026.5.16-beta.3` | `8,856ms` | `1,112ms` | `26,771ms` | `4,690ms` | `8,644ms` | `8,644ms` | n/a |
| `2026.5.16-beta.2` | `8,873ms` | `1,050ms` | `26,639ms` | `4,751ms` | `8,377ms` | `7,308ms` | n/a |
| `2026.5.16-beta.1` | `6,908ms` | `1,196ms` | `21,140ms` | `4,205ms` | `6,714ms` | `6,087ms` | n/a |
| `2026.5.14-beta.2` | `6,979ms` | `990ms` | `21,273ms` | `4,621ms` | `6,439ms` | `5,873ms` | n/a |
| `2026.5.14-beta.1` | `7,300ms` | `1,004ms` | `22,035ms` | `4,211ms` | `6,636ms` | `5,929ms` | n/a |
| `2026.5.12` | `6,569ms` | `2,858ms` | `20,640ms` | `4,170ms` | `7,035ms` | `4,239ms` | n/a |
| `2026.5.9-beta.1` | `5,121ms` | `2,517ms` | `16,759ms` | `4,488ms` | `4,971ms` | `4,565ms` | n/a |
| `2026.5.7` | `6,315ms` | `3,499ms` | `18,948ms` | `4,877ms` | n/a | `4,891ms` | n/a |
| `2026.5.6` | `5,906ms` | `3,497ms` | `18,001ms` | `4,876ms` | n/a | `4,905ms` | n/a |
| `2026.5.4` | `6,249ms` | `3,504ms` | `18,937ms` | `5,121ms` | n/a | `5,135ms` | n/a |
| `2026.5.3` | `631ms` | `3,505ms` | n/a | `4,980ms` | n/a | `3,840ms` | n/a |
| `2026.5.2` | `7,184ms` | `3,501ms` | `20,146ms` | n/a | n/a | `16,769ms` | n/a |
| `2026.4.29` | `0ms` | `17,936ms` | n/a | n/a | n/a | `17,936ms` | n/a |
| `2026.4.27` | `13,388ms` | `4,639ms` | `36,858ms` | n/a | n/a | `15,458ms` | n/a |
| `2026.4.26` | `11,307ms` | `5,880ms` | `32,689ms` | n/a | n/a | `25,305ms` | n/a |
| `2026.4.25` | `17,086ms` | `7,508ms` | `49,357ms` | n/a | n/a | `27,988ms` | n/a |
| `2026.4.24` | `13,298ms` | `2,679ms` | `33,328ms` | n/a | n/a | `8,454ms` | n/a |

<!-- release-coverage:end -->

## Surface Release Coverage

The surface matrix tracks non-channel coverage separately so channel regressions do not get mixed with Gateway RPC or Control UI browser timing. Native RPC rows are preferred over backfilled channel-observed rows for the same version; Control UI release cells require explicit surface measurements and start at `2026.6.1-beta.3`.

<!-- surface-release-coverage:start -->

Latest imported surface run: `2026-07-05T12:58:50.360Z`

| Version | RPC | Control UI |
|---|---:|---:|
| `2026.7.1-beta.2` | - | `341ms` |
| `2026.7.1-beta.1` | `3,549ms` | `407ms` |
| `2026.6.11` | `1,743ms` | `413ms` |
| `2026.6.11-beta.2` | `3,174ms` | `413ms` |
| `2026.6.11-beta.1` | `3,120ms` | `407ms` |
| `2026.6.10` | `4,698ms` | `407ms` |
| `2026.6.10-beta.2` | `3,275ms` | `402ms` |
| `2026.6.10-beta.1` | `1,984ms` | `411ms` |
| `2026.6.9` | - | `403ms` |
| `2026.6.9-beta.1` | - | `405ms` |
| `2026.6.8` | - | `417ms` |
| `2026.6.8-beta.2` | - | `354ms` |
| `2026.6.8-beta.1` | `2,075ms` | `349ms` |
| `2026.6.7-beta.1` | `2,107ms` | `316ms` |
| `2026.6.6` | `2,260ms` | `307ms` |
| `2026.6.6-beta.2` | `1,964ms` | `407ms` |
| `2026.6.5` | `2,636ms` | `308ms` |
| `2026.6.5-beta.6` | `2,301ms` | `306ms` |
| `2026.6.5-beta.5` | `2,437ms` | `346ms` |
| `2026.6.5-beta.3` | `2,516ms` | `310ms` |
| `2026.6.5-beta.2` | `2,593ms` | `333ms` |
| `2026.6.5-beta.1` | `2,450ms` | `398ms` |
| `2026.6.2-beta.1` | `2,605ms` | `308ms` |
| `2026.6.1` | `3,147ms` | `303ms` |
| `2026.6.1-beta.3` | `2,681ms` | `401ms` |
| `2026.6.1-beta.2` | `2,268ms` | n/a |
| `2026.6.1-beta.1` | `2,657ms` | n/a |
| `2026.5.31-beta.4` | `2,471ms` | n/a |
| `2026.5.31-beta.3` | `2,035ms` | n/a |
| `2026.5.31-beta.2` | `2,590ms` | n/a |
| `2026.5.31-beta.1` | `3,103ms` | n/a |
| `2026.5.30-beta.1` | `3,291ms` | n/a |
| `2026.5.28` | `2,815ms` | n/a |
| `2026.5.28-beta.4` | `2,785ms` | n/a |
| `2026.5.28-beta.3` | `2,869ms` | n/a |
| `2026.5.28-beta.1` | `2,654ms` | n/a |
| `2026.5.27` | `4,247ms` | n/a |
| `2026.5.27-beta.1` | `4,306ms` | n/a |
| `2026.5.26` | `4,437ms` | n/a |
| `2026.5.26-beta.2` | `4,527ms` | n/a |
| `2026.5.26-beta.1` | `4,535ms` | n/a |
| `2026.5.25-beta.1` | `4,441ms` | n/a |
| `2026.5.24-beta.2` | `9,066ms` | n/a |
| `2026.5.24-beta.1` | `7,794ms` | n/a |
| `2026.5.22` | `7,905ms` | n/a |
| `2026.5.22-beta.1` | `7,650ms` | n/a |
| `2026.5.20` | `5,082ms` | n/a |
| `2026.5.20-beta.2` | `6,845ms` | n/a |
| `2026.5.20-beta.1` | `6,814ms` | n/a |
| `2026.5.19` | `6,563ms` | n/a |
| `2026.5.19-beta.2` | `6,938ms` | n/a |
| `2026.5.19-beta.1` | `5,071ms` | n/a |
| `2026.5.18` | `6,758ms` | n/a |
| `2026.5.18-beta.1` | `5,977ms` | n/a |
| `2026.5.16-beta.7` | `6,055ms` | n/a |
| `2026.5.16-beta.6` | `4,732ms` | n/a |
| `2026.5.16-beta.5` | `4,740ms` | n/a |
| `2026.5.16-beta.4` | `6,975ms` | n/a |
| `2026.5.16-beta.3` | `8,644ms` | n/a |
| `2026.5.16-beta.2` | `7,308ms` | n/a |
| `2026.5.16-beta.1` | `6,087ms` | n/a |
| `2026.5.14-beta.2` | `5,873ms` | n/a |
| `2026.5.14-beta.1` | `5,929ms` | n/a |
| `2026.5.12` | `4,239ms` | n/a |
| `2026.5.9-beta.1` | `4,565ms` | n/a |
| `2026.5.7` | `4,891ms` | n/a |
| `2026.5.6` | `4,905ms` | n/a |
| `2026.5.4` | `5,135ms` | n/a |
| `2026.5.3` | `3,840ms` | n/a |
| `2026.5.2` | `16,769ms` | n/a |
| `2026.4.29` | `17,936ms` | n/a |
| `2026.4.27` | `15,458ms` | n/a |
| `2026.4.26` | `25,305ms` | n/a |
| `2026.4.25` | `27,988ms` | n/a |
| `2026.4.24` | `8,454ms` | n/a |

<!-- surface-release-coverage:end -->

## Telegram Release Runs

Telegram release runs use the OpenClaw package Telegram live QA lane on Blacksmith with `mock-openai`, scenario `telegram-mentioned-message-reply`, 20 target RTT checks, a 240s scenario timeout, and a 30s per-check timeout. New rows import aggregate timing from `qa-evidence.json`; older rows imported by the retired package RTT wrapper keep their historical per-sample arrays.

The system under test is the published package running its own Telegram bot. The OpenClaw repo only supplies the mock model server and Telegram driver. `p50` is the median normal-reply RTT. Log notes: [2026-05-02 Testbox stable sweep](logs/2026-05-02-testbox-stable-sweep.md).

<!-- release-sweep:start -->

| npm version | RTT p50 | RTT p95 | RSS p50 | RSS p95 | Status |
|---|---:|---:|---:|---:|---|
| `2026.7.1-beta.2` | `1,992ms` | `15,751ms` | `149MB` | `149MB` | ok |
| `2026.7.1-beta.1` | `1,903ms` | `13,706ms` | `151MB` | `151MB` | ok |
| `2026.6.11` | `999ms` | `13,688ms` | `150MB` | `150MB` | ok |
| `2026.6.11-beta.2` | `988ms` | `13,814ms` | `149MB` | `149MB` | ok |
| `2026.6.11-beta.1` | `1,850ms` | `13,848ms` | `150MB` | `150MB` | ok |
| `2026.6.10` | `1,961ms` | `11,020ms` | `148MB` | `148MB` | ok |
| `2026.6.10-beta.2` | `1,945ms` | `12,426ms` | `150MB` | `150MB` | ok |
| `2026.6.10-beta.1` | `1,955ms` | `12,720ms` | `147MB` | `147MB` | ok |
| `2026.6.9` | `1,974ms` | `11,822ms` | `148MB` | `148MB` | ok |
| `2026.6.9-beta.1` | `1,970ms` | `12,843ms` | `150MB` | `150MB` | ok |
| `2026.6.8` | `1,984ms` | `2,983ms` | `137MB` | `137MB` | ok |
| `2026.6.8-beta.2` | `1,927ms` | `3,014ms` | `138MB` | `138MB` | ok |
| `2026.6.8-beta.1` | `1,971ms` | `2,986ms` | `148MB` | `148MB` | ok |
| `2026.6.7-beta.1` | `1,003ms` | `1,955ms` | `153MB` | `153MB` | ok |
| `2026.6.6` | `1,038ms` | `1,997ms` | `158MB` | `158MB` | ok |
| `2026.6.6-beta.2` | `1,109ms` | `2,007ms` | `153MB` | `153MB` | ok |
| `2026.6.5` | `1,002ms` | `2,019ms` | `157MB` | `157MB` | ok |
| `2026.6.5-beta.6` | `993ms` | `1,970ms` | `151MB` | `151MB` | ok |
| `2026.6.5-beta.5` | `1,145ms` | `16,852ms` | `153MB` | `153MB` | ok |
| `2026.6.5-beta.3` | `1,013ms` | `2,695ms` | `151MB` | `151MB` | ok |
| `2026.6.5-beta.2` | `1,013ms` | `1,994ms` | `150MB` | `150MB` | ok |
| `2026.6.5-beta.1` | `1,019ms` | `2,250ms` | `150MB` | `150MB` | ok |
| `2026.6.2-beta.1` | `1,001ms` | `17,759ms` | `150MB` | `150MB` | ok |
| `2026.6.1` | `1,059ms` | `2,044ms` | `149MB` | `149MB` | ok |
| `2026.6.1-beta.3` | `1,089ms` | `3,770ms` | `148MB` | `148MB` | ok |
| `2026.6.1-beta.2` | `988ms` | `2,029ms` | `149MB` | `149MB` | ok |
| `2026.6.1-beta.1` | `1,009ms` | `2,014ms` | `148MB` | `148MB` | ok |
| `2026.5.31-beta.4` | `1,139ms` | `2,023ms` | `147MB` | `147MB` | ok |
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
| `2026.7.1-beta.2` | - | - | - | - | missing: no imported run |
| `2026.7.1-beta.1` | `1,889ms` | `2,036ms` | `1,216MB` | `1,251MB` | ok |
| `2026.6.11` | `1,728ms` | `1,957ms` | `1,185MB` | `1,215MB` | ok |
| `2026.6.11-beta.2` | `1,759ms` | `1,908ms` | `1,185MB` | `1,228MB` | ok |
| `2026.6.11-beta.1` | `1,876ms` | `2,024ms` | `1,176MB` | `1,258MB` | ok |
| `2026.6.10` | `1,790ms` | `1,919ms` | `1,200MB` | `1,225MB` | ok |
| `2026.6.10-beta.2` | `1,795ms` | `1,962ms` | `1,204MB` | `1,219MB` | ok |
| `2026.6.10-beta.1` | `1,971ms` | `2,119ms` | `1,208MB` | `1,233MB` | ok |
| `2026.6.9` | `2,166ms` | `2,507ms` | `1,192MB` | `1,236MB` | ok |
| `2026.6.9-beta.1` | `2,167ms` | `2,332ms` | `1,193MB` | `1,234MB` | ok |
| `2026.6.8` | `2,340ms` | `2,485ms` | `1,023MB` | `1,074MB` | ok |
| `2026.6.8-beta.2` | `2,016ms` | `2,140ms` | `1,032MB` | `1,084MB` | ok |
| `2026.6.8-beta.1` | `2,075ms` | `2,199ms` | `1,030MB` | `1,085MB` | ok |
| `2026.6.7-beta.1` | `2,107ms` | `2,377ms` | `930MB` | `947MB` | ok |
| `2026.6.6` | `2,249ms` | `2,459ms` | `925MB` | `955MB` | ok |
| `2026.6.6-beta.2` | `1,929ms` | `2,145ms` | `931MB` | `949MB` | ok |
| `2026.6.5` | `2,068ms` | `2,629ms` | `933MB` | `1,014MB` | ok |
| `2026.6.5-beta.6` | `1,800ms` | `2,005ms` | `925MB` | `1,011MB` | ok |
| `2026.6.5-beta.5` | `1,933ms` | `2,057ms` | `1,046MB` | `1,127MB` | ok |
| `2026.6.5-beta.3` | `1,892ms` | `1,982ms` | `1,048MB` | `1,141MB` | ok |
| `2026.6.5-beta.2` | `1,837ms` | `2,056ms` | `944MB` | `1,029MB` | ok |
| `2026.6.5-beta.1` | `1,792ms` | `1,939ms` | `942MB` | `1,045MB` | ok |
| `2026.6.2-beta.1` | `1,737ms` | `1,873ms` | `969MB` | `1,172MB` | ok |
| `2026.6.1` | `1,862ms` | `2,067ms` | `976MB` | `1,171MB` | ok |
| `2026.6.1-beta.3` | `1,852ms` | `2,084ms` | `956MB` | `1,170MB` | ok |
| `2026.6.1-beta.2` | `1,824ms` | `2,019ms` | `970MB` | `1,174MB` | ok |
| `2026.6.1-beta.1` | `1,865ms` | `2,087ms` | `961MB` | `1,157MB` | ok |
| `2026.5.31-beta.4` | `1,953ms` | `2,043ms` | `945MB` | `1,154MB` | ok |
| `2026.5.31-beta.3` | `2,030ms` | `2,136ms` | `887MB` | `1,094MB` | ok |
| `2026.5.31-beta.2` | `1,829ms` | `1,999ms` | `895MB` | `1,106MB` | ok |
| `2026.5.31-beta.1` | `1,779ms` | `1,966ms` | `889MB` | `1,053MB` | ok |
| `2026.5.30-beta.1` | `3,344ms` | `4,956ms` | `1,055MB` | `1,106MB` | ok |
| `2026.5.28` | `2,728ms` | `2,967ms` | `958MB` | `967MB` | ok |
| `2026.5.28-beta.4` | `2,665ms` | `2,827ms` | `955MB` | `1,029MB` | ok |
| `2026.5.28-beta.3` | `2,849ms` | `3,182ms` | `944MB` | `972MB` | ok |
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
| `2026.5.16-beta.6` | `7,844ms` | `7,844ms` | `807MB` | `836MB` | timeout |
| `2026.5.16-beta.5` | - | - | `807MB` | `835MB` | timeout |
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
| `2026.7.1-beta.2` | - | - | `651MB` | `651MB` | failed |
| `2026.7.1-beta.1` | `3,549ms` | `3,549ms` | `1,018MB` | `1,018MB` | ok |
| `2026.6.11` | `3,213ms` | `3,213ms` | `1,025MB` | `1,025MB` | ok |
| `2026.6.11-beta.2` | `3,174ms` | `3,174ms` | `1,051MB` | `1,051MB` | ok |
| `2026.6.11-beta.1` | `3,120ms` | `3,120ms` | `1,059MB` | `1,059MB` | ok |
| `2026.6.10` | `4,698ms` | `4,698ms` | `1,024MB` | `1,024MB` | ok |
| `2026.6.10-beta.2` | `3,275ms` | `3,275ms` | `1,041MB` | `1,041MB` | ok |
| `2026.6.10-beta.1` | `3,518ms` | `3,518ms` | `1,055MB` | `1,055MB` | ok |
| `2026.6.9` | - | - | `1,041MB` | `1,041MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.9-beta.1` | - | - | `1,049MB` | `1,049MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8` | - | - | `996MB` | `996MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8-beta.2` | - | - | `995MB` | `995MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8-beta.1` | - | - | `985MB` | `985MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.7-beta.1` | - | - | `965MB` | `965MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.6` | `3,172ms` | `3,237ms` | `981MB` | `993MB` | ok |
| `2026.6.6-beta.2` | `3,199ms` | `4,534ms` | `977MB` | `992MB` | ok |
| `2026.6.5` | `3,148ms` | `3,600ms` | `975MB` | `984MB` | ok |
| `2026.6.5-beta.6` | `2,947ms` | `4,232ms` | `968MB` | `984MB` | ok |
| `2026.6.5-beta.5` | `3,130ms` | `4,424ms` | `1,001MB` | `1,018MB` | ok |
| `2026.6.5-beta.3` | `3,151ms` | `4,456ms` | `1,010MB` | `1,028MB` | ok |
| `2026.6.5-beta.2` | `3,177ms` | `4,673ms` | `960MB` | `971MB` | ok |
| `2026.6.5-beta.1` | `3,192ms` | `4,632ms` | `963MB` | `977MB` | ok |
| `2026.6.2-beta.1` | `3,221ms` | `5,307ms` | `966MB` | `979MB` | ok |
| `2026.6.1` | `3,190ms` | `4,526ms` | `948MB` | `972MB` | ok |
| `2026.6.1-beta.3` | `3,209ms` | `4,498ms` | `959MB` | `970MB` | ok |
| `2026.6.1-beta.2` | `2,940ms` | `4,280ms` | `947MB` | `978MB` | ok |
| `2026.6.1-beta.1` | `2,915ms` | `4,183ms` | `950MB` | `962MB` | ok |
| `2026.5.31-beta.4` | `3,241ms` | `4,979ms` | `950MB` | `962MB` | ok |
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
| `2026.7.1-beta.2` | - | - | - | - | missing: no imported run |
| `2026.7.1-beta.1` | - | - | - | - | missing: no imported run |
| `2026.6.11` | - | - | - | - | missing: no imported run |
| `2026.6.11-beta.2` | - | - | - | - | missing: no imported run |
| `2026.6.11-beta.1` | - | - | - | - | missing: no imported run |
| `2026.6.10` | - | - | - | - | missing: no imported run |
| `2026.6.10-beta.2` | - | - | - | - | missing: no imported run |
| `2026.6.10-beta.1` | - | - | `641MB` | `641MB` | failed |
| `2026.6.9` | - | - | `609MB` | `609MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.9-beta.1` | - | - | `644MB` | `644MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8` | - | - | `635MB` | `635MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8-beta.2` | - | - | `630MB` | `630MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.8-beta.1` | - | - | `599MB` | `599MB` | failed |
| `2026.6.7-beta.1` | - | - | `602MB` | `602MB` | failed |
| `2026.6.6` | - | - | `598MB` | `598MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.6-beta.2` | - | - | `585MB` | `585MB` | failed: QA command exited with status 0 before writing a summary. |
| `2026.6.5` | `3,135ms` | `3,936ms` | `1,013MB` | `1,036MB` | ok |
| `2026.6.5-beta.6` | `3,125ms` | `4,420ms` | `1,017MB` | `1,041MB` | ok |
| `2026.6.5-beta.5` | `2,668ms` | `3,611ms` | `1,060MB` | `1,073MB` | ok |
| `2026.6.5-beta.3` | `2,869ms` | `3,938ms` | `1,058MB` | `1,080MB` | ok |
| `2026.6.5-beta.2` | `3,029ms` | `4,268ms` | `1,020MB` | `1,043MB` | ok |
| `2026.6.5-beta.1` | `3,031ms` | `4,253ms` | `1,018MB` | `1,045MB` | ok |
| `2026.6.2-beta.1` | `3,020ms` | `3,704ms` | `1,007MB` | `1,033MB` | ok |
| `2026.6.1` | `3,303ms` | `4,098ms` | `1,014MB` | `1,048MB` | ok |
| `2026.6.1-beta.3` | `3,147ms` | `3,584ms` | `1,017MB` | `1,029MB` | ok |
| `2026.6.1-beta.2` | `3,072ms` | `3,447ms` | `1,009MB` | `1,042MB` | ok |
| `2026.6.1-beta.1` | `3,267ms` | `3,811ms` | `1,001MB` | `1,041MB` | ok |
| `2026.5.31-beta.4` | `2,957ms` | `3,543ms` | `998MB` | `1,022MB` | ok |
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
