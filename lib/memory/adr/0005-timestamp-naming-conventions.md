---
title: Ratify Timestamp Naming Conventions
seq: "0005"
status: accepted
date: 2026-04-27T00:00:00Z
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json
    range: [50, 112]
    contentHash: 2355044
    note: "Engineering Spec acceptance criteria for UTC naming, migration, and handbook updates."
  - kind: lines
    path: lib/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [52, 109]
    contentHash: 064d359
    note: "ADR-0003 inbox lifecycle boundary this ADR extends with naming rules."
  - kind: lines
    path: lib/memory/adr/0004-documentation-impact-contract.md
    range: [49, 75]
    contentHash: a4dd126
    note: "Documentation-impact discipline for reference updates after path migration."
---

## Context

Pancreator stores temporal pipeline artifacts under `.pan/work/` and operator messages under `lib/inbox/`. Current names do not provide one reverse-chronological convention for day directories, work items, or inbox artifacts. The Engineering Spec requires a UTC-only convention, a migration, and reference updates. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [50, 112], contentHash: 2355044}`.

ADR 0003 defines the inbox lifecycle and archive boundary. This ADR builds on that lifecycle by adding naming rules for active, threaded, outbound, and archived inbox artifacts. Citation: `{kind: lines, path: lib/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [52, 109], contentHash: 064d359}`.

ADR 0004 defines the documentation-impact check. This ADR uses that decision by requiring reference updates after path migration. Citation: `{kind: lines, path: lib/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: 064d359}`.

## Decision

When Pancreator creates or processes an in-scope temporal artifact, Pancreator SHALL use UTC as the only time zone. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [54, 59], contentHash: a4dd126}`.

When Pancreator names a `.pan/work/` day directory, Pancreator SHALL use `{days-to-FDS}_{MM-DD-YY}` with a 6-digit days-to-`FDS` prefix. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [67, 70], contentHash: 2355044}`.

When Pancreator names a `.pan/work/` task directory, Pancreator SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}` and SHALL include a bare integer collision counter between `HHMM` and the semantic suffix when a basename conflict occurs. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [71, 100], contentHash: 2355044}`.

When Pancreator names system-produced artifacts under `lib/inbox/out/` or `lib/inbox/threads/`, Pancreator SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}`. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [77, 84], contentHash: 2355044}`.

When an agent processes a non-conforming human-generated artifact under `lib/inbox/in/` or `lib/inbox/threads/`, that agent MUST append the two time prefixes before downstream processing continues. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [85, 90], contentHash: 2355044}`.

When Pancreator migrates existing artifacts, the migration MUST derive timestamps in this order: first git commit timestamp, then frontmatter `created_at`, then filesystem `mtime`, then operator override. Git commit time is deterministic and replayable across clones; frontmatter is explicit but sparse; `mtime` is mutable; operator override is last because it is manual. Citation: `{kind: lines, path: lib/memory/features/quality-governance/timestamp-naming-conventions/index.json, range: [123, 129], contentHash: 2355044}`.

When Pancreator encodes the policy, the coder SHOULD use the existing compliance descriptor shape in `tests/compliance/` and MAY add Conftest/Rego or an equivalent runner when the descriptor requires executable path validation. Citation: `{kind: lines, path: tests/compliance/schemas/latest.yaml, range: [1, 63], contentHash: 8bbb8a7}`.

When bootstrap migration logic is authored, the coder MUST mark migration-only affordances with `metadata.pancreator-bootstrap-only: true` where contract wrappers or descriptors support metadata. The persistent naming policy SHALL use `metadata.pancreator-bootstrap-only: false`. Citation: `{kind: lines, path: AGENTS.md, range: [87, 89], contentHash: b953d77}`.

## Consequences

- Positive: Operators get reverse-chronological ordering for in-scope temporal artifacts.
- Positive: The policy becomes machine-checkable through compliance and Spec Contract gates.
- Positive: Reference updates become part of migration, not a follow-up activity.
- Negative: The migration touches many `.pan/work/` and `lib/inbox/` paths and therefore requires a manifest-based rollback.
- Negative: Existing references to migrated paths must be rewritten in the same delivery slice.
- Neutral: The post-`2500-01-01T00:00:00Z` rollover rule remains deferred outside this ADR.

## Status

This ADR is accepted on 2026-04-27 (UTC). The ratified Engineering Spec and committed plan record the intake closure inputs.
