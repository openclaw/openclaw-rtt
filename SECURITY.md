# Security Policy

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories for
this repository. If GHSA is unavailable to you, email security@openclaw.ai.

Do not open public issues for vulnerabilities or include secrets, raw transport
payloads, private Discord content, tokens, or exploit details in public reports.

## Scope

In scope:

- RTT import, validation, and README hydration scripts
- workflow behavior that imports or publishes OpenClaw RTT summaries
- accidental disclosure of private transport results, tokens, or logs

Out of scope:

- upstream provider latency, outages, or API behavior
- historical timing variance without a security boundary impact
- compromise of a trusted local account, shell, filesystem, or maintainer device
- scanner-only findings without a reachable exploit path in supported usage

## Expectations

We prioritize reachable issues that affect private data, result integrity, or
safe workflow execution. Include the affected commit, workflow or script, minimal
reproduction steps, and sanitized impact details.
