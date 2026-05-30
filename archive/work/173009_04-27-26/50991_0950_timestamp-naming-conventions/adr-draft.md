> Promoted to `lib/memory/adr/0005-timestamp-naming-conventions.md`; this file stays for the work audit trail.

# ADR 0005: Timestamp Naming Conventions

## Context

Pancreator stores temporal pipeline artifacts under `work/` and operator messages under `lib/inbox/`. Current names do not provide one reverse-chronological convention for day directories, work items, or inbox artifacts. The Engineering Spec requires a UTC-only convention, a migration, and reference updates. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [50, 112], contentHash: TBD-on-commit}`.

ADR 0003 defines the inbox lifecycle and archive boundary. This ADR builds on that lifecycle by adding naming rules for active, threaded, outbound, and archived inbox artifacts. Citation: `{kind: lines, path: lib/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [52, 109], contentHash: TBD-on-commit}`.

ADR 0004 defines the documentation-impact check. This ADR uses that decision by requiring reference updates after path migration. Citation: `{kind: lines, path: lib/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: TBD-on-commit}`.

## Decision

Status: Proposed.

When Pancreator creates or processes an in-scope temporal artifact, Pancreator SHALL use UTC as the only time zone. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [54, 59], contentHash: TBD-on-commit}`.

When Pancreator names a `work/` day directory, Pancreator SHALL use `{days-to-FDS}_{MM-DD-YY}` with a 6-digit days-to-`FDS` prefix. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [67, 70], contentHash: TBD-on-commit}`.

When Pancreator names a `work/` task directory, Pancreator SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}` and SHALL include a bare integer collision counter between `HHMM` and the semantic suffix when a basename conflict occurs. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [71, 100], contentHash: TBD-on-commit}`.

When Pancreator names system-produced artifacts under `lib/inbox/out/` or `lib/inbox/threads/`, Pancreator SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}`. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [77, 84], contentHash: TBD-on-commit}`.

When an agent processes a non-conforming human-generated artifact under `lib/inbox/in/` or `lib/inbox/threads/`, that agent MUST append the two time prefixes before downstream processing continues. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [85, 90], contentHash: TBD-on-commit}`.

When Pancreator migrates existing artifacts, the migration MUST derive timestamps in this order: first git commit timestamp, then frontmatter `created_at`, then filesystem `mtime`, then operator override. Git commit time is deterministic and replayable across clones; frontmatter is explicit but sparse; `mtime` is mutable; operator override is last because it is manual. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [123, 129], contentHash: TBD-on-commit}`.

When Pancreator encodes the policy, the coder SHOULD use the existing compliance descriptor shape in `lib/internal/tests/compliance/` and MAY add Conftest/Rego or an equivalent runner when the descriptor requires executable path validation. Citation: `{kind: lines, path: lib/internal/tests/compliance/schemas/latest.yaml, range: [1, 63], contentHash: TBD-on-commit}`.

When bootstrap migration logic is authored, the coder MUST mark migration-only affordances with `metadata.pancreator-bootstrap-only: true` where contract wrappers or descriptors support metadata. The persistent naming policy SHALL use `metadata.pancreator-bootstrap-only: false`. Citation: `{kind: lines, path: AGENTS.md, range: [87, 89], contentHash: TBD-on-commit}`.

## Consequences

- Positive: Operators get reverse-chronological ordering for in-scope temporal artifacts.
- Positive: The policy becomes machine-checkable through compliance and Spec Contract gates.
- Positive: Reference updates become part of migration, not a follow-up activity.
- Negative: The migration touches many `work/` and `lib/inbox/` paths and therefore requires a manifest-based rollback.
- Negative: Existing references to migrated paths must be rewritten in the same delivery slice.
- Neutral: The post-`2500-01-01T00:00:00Z` rollover rule remains deferred outside this ADR.
