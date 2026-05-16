# Channel Expansion

`openclaw-rtt` should stay a data repository, not become a second QA harness. The harness lives in `openclaw/openclaw`; this repo imports normalized timing rows, regenerates the README dashboard, and records enough per-run JSON to audit a bad point on the graph.

## Current State

- Telegram main/release RTT still uses the older `pnpm rtt` result shape and writes `data/rtt.jsonl`.
- Discord main RTT uses the live QA lane but has its own importer and writes `data/discord-rtt.jsonl`.
- Release Discord, Slack, WhatsApp, Matrix, iMessage, Microsoft Teams, and future channels had no reusable data lane here.
- CI only measured live scheduled data. It did not protect PRs that change importers, README generation, or workflows.
- Scheduled workflows needed `contents: write` to commit results, but secondary OpenClaw checkouts did not need persisted credentials.

## New Channel Contract

New live transport channels should use the channel RTT lane when the OpenClaw CLI exposes `pnpm openclaw qa <channel>` and the lane emits a QA summary artifact.

Required pieces:

- Add the channel id, display label, CLI command, and default canary scenario in `scripts/channel-rtt-config.mjs`.
- Add or extend a workflow that runs `pnpm openclaw qa <channel>` with Convex-managed CI credentials and `OPENCLAW_QA_REDACT_PUBLIC_METADATA=1`.
- Import with `scripts/import-live-transport-rtt.mjs`, passing the summary TSV, channel id, `openclaw@main` or release spec, version/ref, provider mode, and scenario id.
- Commit only `README.md`, `data/channel-rtt/<channel>.jsonl`, and `channel-runs/<channel>/`.
- Add importer proof with `node --test` when the new channel has a new artifact shape.

## First Wave

`main-channel-rtt.yml` starts with Slack and WhatsApp because both are built-in OpenClaw live transports and their summaries already carry scenario-level RTT fields. The workflow runs channels serially to avoid competing README/data commits.

Discord is intentionally not migrated in the same step. Its summary currently omits RTT fields, so the generic importer supports observed-message timestamp fallback and has test coverage for that path, but the existing Discord workflow remains stable while the new channel lane proves itself.

Telegram is listed in the channel config for the future live-transport path, but the current production graph remains on the older `pnpm rtt` package-result path because that is what release sweeps already use.

## CI And Security

- `CI` checks script syntax, importer tests, data validation, and README regeneration on PRs.
- `CodeQL` enables JavaScript analysis for importer/workflow-support code.
- Dependabot tracks GitHub Action updates.
- Secondary `openclaw/openclaw` checkouts use `persist-credentials: false`.
- Live QA workflows redact public metadata before writing artifacts.

## Next Channels

Recommended order:

1. Discord release RTT via the generic importer once the main lane has produced channel data.
2. Telegram live-transport main RTT if we want one dashboard shape for all channel canaries.
3. Matrix once its QA runner is available as a stable `pnpm openclaw qa <channel>` contribution in the release artifact.
4. iMessage and Microsoft Teams after they expose equivalent live transport summaries and CI-safe credentials.

Do not add a channel by copying an entire bespoke importer. That path looks fast once and then becomes boring maintenance debt.
