# Compliance remediation summary

## Files changed

- `/personas/compliance-auditor.md`
- `/.cursor/agents/compliance-auditor.md`
- `/work/compliance-audit-2026-04-26/compliance-audit.md`
- `/work/compliance-audit-2026-04-26/compliance-remediation.md`

## Unresolved findings checklist

- [ ] `block` - Backfill immutable `contentHash` values across `severity: block` contract wrappers in `/memory/features/**/contracts/*.yaml`.
- [ ] `major` - Backfill unresolved `references[].contentHash` placeholders in `/memory/handbook/run-log-schema.md`.

## Next-owner routing

- `contract-writer`: own the block finding and deliver a corpus-level citation-hash backfill for block-severity wrappers.
- `librarian`: own the handbook citation-hash backfill and coordinate canonical anchor updates.
- `reviewer`: verify the backfill diff satisfies Layer 1 citation requirements before ratification.
