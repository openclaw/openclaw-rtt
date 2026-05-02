# 2026-05-02 Testbox Stable Sweep

Ran the last ten non-beta `openclaw` npm releases through the OpenClaw Telegram RTT harness on Blacksmith Testbox.

Settings:

- provider mode: `mock-openai`
- scenario: `telegram-mentioned-message-reply`
- samples: 20
- canary timeout: 240s
- sample timeout: 30s

The first shared Testbox sweep was interrupted by Testbox SSH resets. Final results were collected with one fresh Testbox per remaining version, downloading each `result.json` before stopping the box.

| npm version | Result | Samples | p50 | p95 |
|---|---:|---:|---:|---:|
| `2026.4.29` | Pass | 20 | `17,936ms` | `24,517ms` |
| `2026.4.27` | Pass | 20 | `4,639ms` | `13,664ms` |
| `2026.4.26` | Pass | 20 | `5,880ms` | `18,610ms` |
| `2026.4.25` | Pass | 20 | `7,508ms` | `27,982ms` |
| `2026.4.24` | Pass | 20 | `2,679ms` | `13,451ms` |
| `2026.4.23` | Pass | 20 | `2,507ms` | `14,671ms` |
| `2026.4.22` | Pass | 20 | `2,497ms` | `14,847ms` |
| `2026.4.21` | Pass | 20 | `3,502ms` | `16,828ms` |
| `2026.4.20` | Pass | 20 | `3,504ms` | `16,796ms` |
| `2026.4.15` | Pass | 20 | `3,503ms` | `16,809ms` |
