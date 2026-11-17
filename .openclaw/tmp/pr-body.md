## What Problem This Solves

RTT pull requests can describe implementation details without explaining which reporting or measurement-import task changes, leaving readers to inspect the diff to understand the purpose.

## User Impact

Authors get concrete, repository-specific examples for clear titles and problem statements. Evidence summaries explain what was verified and the result before presenting commands or logs.

No runtime behavior, required sections, checklists, review gates, or dependencies change.

## Why This Change Was Made

Adapt the reader-first guidance from the OpenClaw template to RTT report readers and measurement importers. Examples contrast stale dashboard timings and Windows-generated sample-path imports with implementation-only descriptions. Existing headings, risk guidance, and maintainer-edit instructions remain intact.

## Evidence

- Template contract checks passed: all noncomment content and the exact problem prompt are unchanged, and comment delimiters remain balanced.
- All 234 existing tests passed. Data validation and generated-README checks passed without changing the README.
- Source and scope review found no actionable issue in the template-only change. No runtime or visual UI change requires additional proof.

<details>
<summary>Validation details</summary>

- Candidate: `942b23ee2eb9eb799b7b67c03c5c7ab35de91007`; base: `557ddb14270e43baf3744eb5d96681423cbab64e`.
- `npm test`: 234 passed, zero failures.
- `npm run check`: syntax, stored-data validation, and unchanged generated README passed.
- `git diff --check`: passed.
- Comparison with the original template confirmed unchanged rendered headings, User Impact and Why This Change Was Made guidance, maintainer-edit requirement, and the literal sentence “Describe the concrete user, product, or operational problem.”
- Examples grounded in the repository README and `docs/data-imports.md`; no new tests or review gates added.

</details>

Requested by @hannesrudolph.

## Work sessions

Linked for team reference; these sessions aren’t public.

- [Original discussion with @hannesrudolph](https://team.openclaw.ai/chat/roboclaw/~key/dashboard/3b8142ee-a68a-4501-b00a-6e45bfe88c0e)
- [Implementation and verification](https://team.openclaw.ai/chat/roboclaw/~key/dashboard/e0e61f45-8b35-471d-8d48-dd31d544dfa2)
