# Changelog

## Unreleased

- Fix concurrent release QA auth seeding leaking state directories between agents, and roll back partial compatibility patch writes while preserving file permissions. Thanks @petercheng.
- Fix channel imports, surface imports, and RSS backfills failing to find sample files in TSV lists with CRLF line endings.
- Fix surface imports recording incorrect run bounds for unordered samples or accepting invalid intermediate timestamps; normalize imported run timestamps to UTC.
