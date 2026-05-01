# 2026-05-01 Normal-Reply Sweep Logs

Command shape:

```sh
pnpm rtt 'openclaw@<version>' --samples 20 --timeout-ms 240000 --sample-timeout-ms 30000 --output /tmp/openclaw-rtt-last10-normal-reply-success20/runs
```

Mode:

- Provider: `mock-openai`
- Scenario: `telegram-mentioned-message-reply`
- Canary: `/status`
- RTT sample: a mentioned Telegram message replying to the canary, expecting a unique `OPENCLAW_E2E_OK_N` marker.
- Target: 20 successful normal-reply samples per package.

## Summary

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

## Failure Notes

### `2026.4.23`

Failed before collecting normal-reply samples. Gateway startup delayed Telegram channel readiness behind pricing and update checks.

```text
2026-05-01T13:32:34.419+00:00 [model-pricing] OpenRouter pricing fetch failed (timeout 30s)
2026-05-01T13:32:34.420+00:00 [model-pricing] LiteLLM pricing fetch failed (timeout 30s)
2026-05-01T13:32:40.431+00:00 [gateway] update available (latest): v2026.4.29 (current v2026.4.23)
2026-05-01T13:32:41.351+00:00 [telegram] [default] starting provider (@cameronclawbot)
```

Raw report:

```text
## Telegram canary
- Status: fail
- Details: timed out after 240000ms waiting for Telegram message

## Telegram normal reply
- Status: fail
- Details: 0/20 warm samples passed
- Samples: 0/20
```

### `2026.4.25`

Normal replies started, but reply processing regularly exceeded the 30s sample timeout.

```text
2026-05-01T13:56:35.747+00:00 [agent/embedded] embedded run done ... durationMs=80692
2026-05-01T13:56:36.181+00:00 [diagnostic] message processed ... duration=89434ms
2026-05-01T13:57:04.154+00:00 [agent/embedded] embedded run done ... durationMs=25042
2026-05-01T13:58:43.172+00:00 [agent/embedded] embedded run done ... durationMs=31460
```

Raw report:

```text
## Telegram canary
- Status: pass
- Details: observed SUT message 2160
- RTT: 159784ms

## Telegram normal reply
- Status: fail
- Details: 0/20 warm samples passed
- Samples: 0/20
```

### `2026.4.29`

The canary was fast, but normal replies failed under the sample threshold. Logs show costly agent prep plus Telegram network failures.

```text
2026-05-01T14:44:38.644+00:00 [gateway] [plugins] installed bundled runtime deps before gateway startup in 44700ms
[agent/embedded] [trace:embedded-run] startup stages ... totalMs=41944 ... model-resolution:11741ms ... auth:13135ms ... attempt-dispatch:17062ms
[agent/embedded] [trace:embedded-run] prep stages ... totalMs=529546 ... core-plugin-tools:21052ms ... system-prompt:460011ms ... stream-setup:30347ms
2026-05-01T14:54:01.452+00:00 [telegram] Polling stall detected (no completed getUpdates for 552.25s); forcing restart.
2026-05-01T14:54:56.423+00:00 [telegram] sendMessage failed: Network request for 'sendMessage' failed!
```

Raw report:

```text
## Telegram canary
- Status: pass
- Details: observed SUT message 2323
- RTT: 9704ms

## Telegram normal reply
- Status: fail
- Details: 0/20 warm samples passed
- Samples: 0/20
```
