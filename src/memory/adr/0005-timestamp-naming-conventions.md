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
    path: src/memory/features/timestamp-naming-conventions/spec.md
    range: [50, 112]
    contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872
    note: "Engineering Spec acceptance criteria for UTC naming, migration, and handbook updates."
  - kind: lines
    path: src/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [52, 109]
    contentHash: 64015f635674c3aef841341c23da00568ac2002074e4c676d8ce813d180adf15
    note: "ADR-0003 inbox lifecycle boundary this ADR extends with naming rules."
  - kind: lines
    path: src/memory/adr/0004-documentation-impact-contract.md
    range: [49, 75]
    contentHash: 002c6fd72bb983edfe6cacf76a7cb01d6de95f7a6d3fd3dd82889a88e6b83e16
    note: "Documentation-impact discipline for reference updates after path migration."
---

## Context

Tesseract stores temporal pipeline artifacts under `src/work/` and operator messages under `src/inbox/`. Current names do not provide one reverse-chronological convention for day directories, work items, or inbox artifacts. The Engineering Spec requires a UTC-only convention, a migration, and reference updates. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [50, 112], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

ADR 0003 defines the inbox lifecycle and archive boundary. This ADR builds on that lifecycle by adding naming rules for active, threaded, outbound, and archived inbox artifacts. Citation: `{kind: lines, path: src/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [52, 109], contentHash: 64015f635674c3aef841341c23da00568ac2002074e4c676d8ce813d180adf15}`.

ADR 0004 defines the documentation-impact check. This ADR uses that decision by requiring reference updates after path migration. Citation: `{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: 64015f635674c3aef841341c23da00568ac2002074e4c676d8ce813d180adf15}`.

## Decision

When Tesseract creates or processes an in-scope temporal artifact, Tesseract SHALL use UTC as the only time zone. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [54, 59], contentHash: 002c6fd72bb983edfe6cacf76a7cb01d6de95f7a6d3fd3dd82889a88e6b83e16}`.

When Tesseract names a `src/work/` day directory, Tesseract SHALL use `{days-to-FDS}_{MM-DD-YY}` with a 6-digit days-to-`FDS` prefix. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [67, 70], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

When Tesseract names a `src/work/` task directory, Tesseract SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}` and SHALL include a bare integer collision counter between `HHMM` and the semantic suffix when a basename conflict occurs. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [71, 100], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

When Tesseract names system-produced artifacts under `src/inbox/out/` or `src/inbox/threads/`, Tesseract SHALL use `{SID-prefix}_{HHMM}_{semantic-suffix}`. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [77, 84], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

When an agent processes a non-conforming human-generated artifact under `src/inbox/in/` or `src/inbox/threads/`, that agent MUST append the two time prefixes before downstream processing continues. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [85, 90], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

When Tesseract migrates existing artifacts, the migration MUST derive timestamps in this order: first git commit timestamp, then frontmatter `created_at`, then filesystem `mtime`, then operator override. Git commit time is deterministic and replayable across clones; frontmatter is explicit but sparse; `mtime` is mutable; operator override is last because it is manual. Citation: `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [123, 129], contentHash: 0573437599dea193c9d0217f6c58204c57a0ec4b90cae862c13cfd835c8a2872}`.

When Tesseract encodes the policy, the coder SHOULD use the existing compliance descriptor shape in `tests/compliance/` and MAY add Conftest/Rego or an equivalent runner when the descriptor requires executable path validation. Citation: `{kind: lines, path: tests/compliance/schemas/latest.yaml, range: [1, 63], contentHash: 8bbb8a715d1badc1f8c67a19cd7ddbeccef406c735e6547c77478ca513b1e7e1}`.

When bootstrap migration logic is authored, the coder MUST mark migration-only affordances with `metadata.tesseract-bootstrap-only: true` where contract wrappers or descriptors support metadata. The persistent naming policy SHALL use `metadata.tesseract-bootstrap-only: false`. Citation: `{kind: lines, path: AGENTS.md, range: [87, 89], contentHash: e0374274c6e58a21d247230cb4da6f2d24a2997c6666d6cd56ad13e9dd03015a}`.

## Consequences

- Positive: Operators get reverse-chronological ordering for in-scope temporal artifacts.
- Positive: The policy becomes machine-checkable through compliance and Spec Contract gates.
- Positive: Reference updates become part of migration, not a follow-up activity.
- Negative: The migration touches many `src/work/` and `src/inbox/` paths and therefore requires a manifest-based rollback.
- Negative: Existing references to migrated paths must be rewritten in the same delivery slice.
- Neutral: The post-`2500-01-01T00:00:00Z` rollover rule remains deferred outside this ADR.

## Status

This ADR is accepted on 2026-04-27 (UTC). The ratified Engineering Spec and committed plan record the intake closure inputs.
