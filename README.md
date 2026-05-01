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
pnpm rtt openclaw@latest
pnpm rtt openclaw@2026.4.30 --provider live-frontier
```

## Data

- `data/rtt.jsonl`: append-only graph source, one normalized run per line.
- `runs/<run-id>/result.json`: copied per-run result record for audit/debug.

Raw Telegram QA artifacts stay in the OpenClaw repo artifact directory unless explicitly copied in later.

## Latest Stable Sweep

Measured on 2026-05-01 with the OpenClaw repo harness on `mock-openai`, scenario `telegram-mentioned-message-reply`, and a 60s scenario timeout.

| npm version | Canary RTT | Mention RTT | Result | Notes |
|---|---:|---:|---|---|
| `2026.4.15` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.20` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.21` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.22` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.23` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.24` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.25` | - | - | Not measured | Harness/runtime mismatch: `openclaw/plugin-sdk/gateway-runtime` did not export `callGatewayFromCli`. |
| `2026.4.26` | - | - | Not measured | Gateway rejected the current QA config: `messages.groupChat.visibleReplies` was unknown to this release. |
| `2026.4.27` | `3104ms` | Timed out | Fail | Canary replied; mention reply timed out after 60s. |
| `2026.4.29` | `6672ms` | Timed out | Fail | Canary replied; mention reply timed out after 60s. |
