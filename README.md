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

Measured on 2026-05-01 with the OpenClaw repo black-box harness on `mock-openai`, scenario `telegram-mentioned-message-reply`, and a 240s scenario timeout.

The SUT is the published package running its own Telegram bot. The current repo only supplies the mock model server and Telegram driver. `Command RTT` is the second `/status` command round trip after startup.

| npm version | Canary RTT | Command RTT | Result | Notes |
|---|---:|---:|---|---|
| `2026.4.15` | `35,753ms` | `3,649ms` | Pass | Older startup path; command RTT stable after provider is up. |
| `2026.4.20` | `33,371ms` | `4,171ms` | Pass | Older startup path; command RTT stable after provider is up. |
| `2026.4.21` | `32,558ms` | `4,300ms` | Pass | Older startup path; command RTT stable after provider is up. |
| `2026.4.22` | `105,931ms` | `10,662ms` | Pass | Slow first response. |
| `2026.4.23` | `239,125ms` | `13,194ms` | Pass | Slow first response. |
| `2026.4.24` | `64,616ms` | `1,692ms` | Pass | Fast command RTT after startup. |
| `2026.4.25` | `173,874ms` | `8,720ms` | Pass | Slow first response. |
| `2026.4.26` | `129,844ms` | `42,086ms` | Pass | Slow first and second response. |
| `2026.4.27` | `10,026ms` | `1,509ms` | Pass | Uses `messages.groupChat.visibleReplies=automatic`. |
| `2026.4.29` | `9,629ms` | `2,502ms` | Pass | Uses `messages.groupChat.visibleReplies=automatic`. |
