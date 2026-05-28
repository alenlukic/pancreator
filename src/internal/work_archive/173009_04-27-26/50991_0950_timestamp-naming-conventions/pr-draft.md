---
title: "[bootstrap-phase-4] timestamp naming conventions: encode policy + tooling (write deferred)"
feature_id: timestamp-naming-conventions
stage: ship
status: awaiting_human_approval
gate: human_approval
authored_by: supervisor
authored_at: 2026-04-27T16:27:39Z
worktree_branch: bootstrap
worktree_head: ff57fb856e752d61f1b0457eab014cf3c39b798b
operator_instruction: |
  Paste the title below into `gh pr create --title` and the body (everything
  after the `---` block) into `gh pr create --body` (or `--body-file`).
  Supervisor MUST NOT execute `gh pr create`; the operator alone advances
  past the `human_approval` gate per AGENTS.md §5 and PRD §7 line 690.
references:
  - kind: lines
    path: src/memory/features/timestamp-naming-conventions/spec.md
    range: [50, 112]
    contentHash: TBD-on-commit
    note: "Engineering Spec acceptance criteria for the slice."
  - kind: lines
    path: src/memory/adr/0005-timestamp-naming-conventions.md
    range: [35, 51]
    contentHash: TBD-on-commit
    note: "ADR 0005 Decision section codifying the UTC naming policy and migration precedence."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [135, 147]
    contentHash: TBD-on-commit
    note: "Inbox-lifecycle §3c actor-ownership rule for non-conforming human-generated inbox artifacts."
  - kind: lines
    path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json
    range: [1, 11]
    contentHash: TBD-on-commit
    note: "Dry-run manifest summary counters cited verbatim in Verification."
  - kind: lines
    path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md
    range: [109, 116]
    contentHash: TBD-on-commit
    note: "Reviewer warn findings L1 (resolved) and L2 (deferred to librarian)."
---

## Summary

- The slice encodes the timestamp naming policy as one compliance descriptor, three Spec Contracts at `severity: block`, and an audited migration tool whose write mode stays gated behind `DAEDALINE_MIGRATION_GO=1`. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [50, 112], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [35, 49], contentHash: TBD-on-commit}`
- ADR 0005 ratifies UTC, `FDS = 2500-01-01T00:00:00Z`, `SID = 86400 s`, the `src/work/{days-to-FDS}_{MM-DD-YY}/{SID}_{HHMM}_{slug}/` shape, the inbox basename shape, and the migration timestamp-source precedence (git, frontmatter, mtime, override). `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [37, 47], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [54, 100], contentHash: TBD-on-commit}`
- Inbox-lifecycle §3c records the actor-ownership rule that any agent processing a non-conforming human-generated inbox artifact MUST append the two time prefixes before downstream processing continues, keeping the obligation in the handbook layer rather than per-persona prose. `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [135, 147], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [85, 90], contentHash: TBD-on-commit}`

## Lineage

- `1ca2afd` — plan timestamp naming conventions (plan.md, adr-draft.md, touch-set.json staged for implement).
- `7d7b62a` — implement timestamp naming conventions (compliance descriptor, three Spec Contracts, `src/internal/tools/migrate-timestamp-naming.mjs` + tests, ADR 0005 promoted, `inbox-lifecycle.md` §3c, dry-run manifest, feature index updated).
- `635e5bb` — review timestamp naming conventions (review.md verdict `pass-with-conditions`, no `block` findings, five verification gates green, citation-range fix L1 applied).
- `ff57fb8` — report timestamp naming conventions (delivery-report.md authored, feature index promoted to `current_stage: report`, handoff to supervisor for ship).

## Verification

The reviewer ran every gate green from a clean shell at commit `7d7b62a` (and re-ran the strict-references audit at `635e5bb`):

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm run check:phase0a` — pass (replayed by supervisor at `ff57fb8`; exit 0).
- `pnpm migration:test` — pass (`# pass 18 / # fail 0`).
- `pnpm -r run test` — pass (all workspaces green).
- `node src/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references` — pass; exit 0; `strictReferenceAudit.staleRows: []`.

Migration dry-run manifest summary: `renames=35`, `referenceUpdates=451`, `collisionWarnings=0`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json, range: [1, 11], contentHash: TBD-on-commit}`

## Migration write deferral

The slice intentionally defers migration write mode (`node src/internal/tools/migrate-timestamp-naming.mjs --write` under `DAEDALINE_MIGRATION_GO=1`) to a follow-up commit AFTER this PR merges. The deferral keeps the rename pass auditable in one quiescent-state commit and matches ADR 0005 §Consequences and the review's safe-write disposition. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [896, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [55, 60], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [213, 229], contentHash: TBD-on-commit}`

The follow-up task `timestamp-naming-conventions-migration-write` MUST run from a clean working tree on `main`, MUST set `DAEDALINE_MIGRATION_GO=1`, MUST regenerate the dry-run manifest immediately before write (per L3), and MUST keep `--strict-references` green. The dry-run manifest at `src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json` is the rollback source of truth. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/delivery-report.md, range: [27, 30], contentHash: TBD-on-commit}`

## Open warnings

- L1 — `[warn]` resolved in the report stage. The citation range in `src/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml` now anchors `chooseTimestamp` at lines `[163, 193]`. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml, range: [16, 20], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [109, 113], contentHash: TBD-on-commit}`
- L2 — `[warn]` deferred to the librarian content-hash refresh pass. The §3c reference entry in `src/memory/handbook/inbox-lifecycle.md` carries `contentHash: TBD-on-commit` while the surrounding entries already hold sha256 hashes; the librarian's post-merge indexing pass refreshes the entry. `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [135, 147], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [114, 116], contentHash: TBD-on-commit}`

## Test plan

- [ ] Confirm Spec acceptance criteria coverage by spot-checking the review report's acceptance-criteria table against `src/memory/features/timestamp-naming-conventions/spec.md` lines `[50, 112]` and the test sources cited per row. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [75, 107], contentHash: TBD-on-commit}`
- [ ] Confirm migration safety guards by reading `src/internal/tools/migrate-timestamp-naming.mjs` write-mode block: `DAEDALINE_MIGRATION_GO=1` env-var guard, `--strict-references` audit, manifest-backed rollback. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [789, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [138, 147], contentHash: TBD-on-commit}`
- [ ] Replay the verification gates from a clean shell at the merge commit: `pnpm typecheck`, `pnpm lint`, `pnpm run check:phase0a`, `pnpm migration:test`, `pnpm -r run test`, and `node src/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 199], contentHash: TBD-on-commit}`
- [ ] Ratify the post-merge migration-write task by approving `timestamp-naming-conventions-migration-write` for the next pipeline run, with `DAEDALINE_MIGRATION_GO=1` set explicitly and the manifest regenerated immediately before write per finding L3. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/delivery-report.md, range: [37, 39], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [115, 116], contentHash: TBD-on-commit}`
