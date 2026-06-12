# Channel Expansion

`openclaw-rtt` should stay a data repository, not become a second QA harness. The harness lives in `openclaw/openclaw`; this repo imports normalized timing rows, regenerates the README dashboard, and records enough per-run JSON to audit a bad point on the graph.

## Current State

- All imported rows use `data/channels/<channel>/<version>.jsonl` and `runs/<channel>/<run-id>/result.json`.
- Telegram main/release RTT uses the OpenClaw package Telegram live lane and imports aggregate timing from `qa-evidence.json` through the shared Telegram channel storage path.
- Discord main/release RTT uses the live QA lane with a specialized importer because its summary currently needs observed-message timestamp fallback.
- Slack and WhatsApp main RTT use the reusable live-transport importer.
- The Discord release resolver backfills missing versions from the Telegram release baseline before measuring future versions. It skips releases that predate or fail the Discord canary contract instead of reporting them as runnable gaps.
- Matrix, iMessage, Microsoft Teams, and future channels have no reusable data lane here yet.
- CI only measured live scheduled data. It did not protect PRs that change importers, README generation, or workflows.
- Scheduled workflows needed `contents: write` to commit results, but secondary OpenClaw checkouts did not need persisted credentials.

## Adding Channels

New live transport channels should use the channel RTT lane when the OpenClaw CLI exposes `pnpm openclaw qa <channel>` and the lane emits a QA summary artifact.

Generic live-transport RTT imports are for channels backed by `pnpm openclaw qa <channel>`. New channels should land one at a time with their workflow, credential contract, scenario id, and importer proof.

Required pieces:

- Add the channel id, display label, CLI command, and default canary scenario in `scripts/channel-rtt-config.mjs`.
- Add or extend a workflow that runs `pnpm openclaw qa <channel>` with Convex-managed CI credentials and `OPENCLAW_QA_REDACT_PUBLIC_METADATA=1`.
- Import with `scripts/import-live-transport-rtt.mjs`, passing the summary TSV, channel id, `openclaw@main` or release spec, version/ref, provider mode, and scenario id.
- Capture per-sample process resource metrics with `/usr/bin/time` and include the metrics path in the importer TSV so RSS appears beside RTT in the dashboard.
- Record the attempt count in the resource metrics file. The importer stores per-sample attempts and aggregate retry count so the dashboard can show when a green sample needed transient recovery.
- Commit only `README.md`, `data/channels/<channel>/`, and `runs/<channel>/`.
- Add importer proof with `node --test` when the new channel has a new artifact shape.

## First Wave

`main-channel-rtt.yml` starts with Slack and WhatsApp because both are built-in OpenClaw live transports and their summaries already carry scenario-level RTT fields. The workflow measures channels in parallel, uploads per-channel import artifacts, and then uses one serialized report job to avoid competing README/data commits.

Each sample is wrapped with `/usr/bin/time` and imports process max RSS in kilobytes alongside the scenario RTT. The workflow uses bounded exponential retry for transient missing-summary failures and writes the final attempt count into the imported row. The README keeps the public channel table compact with RTT p50/p95 and RSS p50/p95; retry and scenario details stay in the JSON rows and summaries.

Discord is intentionally not migrated to the generic live-transport importer yet. Its summary currently omits RTT fields, so the generic importer supports observed-message timestamp fallback and has test coverage for that path, but the existing Discord workflow remains stable while the new channel lane proves itself.

Telegram is listed in the channel config because the package Telegram live lane now emits QA evidence for `telegram-mentioned-message-reply`. Future Telegram rows keep the same dashboard metrics as older rows, but the source is aggregate `qa-evidence.json` timing rather than the retired package RTT wrapper's per-sample result JSON.

Do not read cross-channel values as pure transport rankings. Telegram release rows use `telegram-mentioned-message-reply`; Discord, Slack, and WhatsApp rows use canary scenarios. The live-transport lane also includes QA-lab process overhead in RSS because the measured process is `pnpm openclaw qa <channel>`, not only the channel adapter.

Slack and WhatsApp rows come from `openclaw qa <channel>` canaries, so their RSS columns include the QA-lab sample process and should not be read as pure channel transport memory.

## CI And Security

- `CI` checks script syntax, importer tests, data validation, and README regeneration on PRs.
- `CodeQL` enables JavaScript analysis for importer/workflow-support code.
- Dependabot tracks GitHub Action updates.
- Secondary `openclaw/openclaw` checkouts use `persist-credentials: false`.
- Live QA workflows redact public metadata before writing artifacts.

## Next Channels

Recommended order:

1. Telegram live-transport main RTT if we want one dashboard shape for all channel canaries.
2. Matrix once its QA runner is available as a stable `pnpm openclaw qa <channel>` contribution in the release artifact.
3. iMessage and Microsoft Teams after they expose equivalent live transport summaries and CI-safe credentials.

Do not add a channel by copying an entire bespoke importer. That path looks fast once and then becomes boring maintenance debt.
