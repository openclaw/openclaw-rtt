# AGENTS.md

`openclaw-rtt` stores OpenClaw round-trip timing summaries and import scripts.
Keep changes small, data-safe, and reproducible from checked-in scripts.

## Rules

- Do not commit live tokens, `.env` files, raw provider payloads, private
  Discord data, or unredacted transport logs.
- Generated README updates must come from `scripts/update-readme.mjs`.
- Keep imported result data compact and reviewable.
- Prefer additive script changes; do not rewrite historical result data unless
  the source and reason are clear in the commit.

## Checks

```bash
npm run validate
npm test
npm run check
git diff --check
```
