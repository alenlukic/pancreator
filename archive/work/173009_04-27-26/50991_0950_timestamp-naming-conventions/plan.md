# Timestamp Naming Conventions Plan

## Architecture Summary

When this Feature enters implementation, the coder MUST encode the naming convention as policy before any migration mutates `work/` or `lib/inbox/` paths. The policy SHALL cover UTC derivation, `FDS = 2500-01-01T00:00:00Z`, `SID = 86400 s`, `work/` day and task directory basenames, inbox artifact basenames, collision counters, and actor-owned prefixing for non-conforming human-generated inbox artifacts. The migration SHALL then use the encoded convention to rename in-scope artifacts and update references that name migrated paths. This plan satisfies the Engineering Spec feature statement, acceptance criteria, out-of-scope limits, and deferrals. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [50, 129], contentHash: TBD-on-commit}`.

## Touch Set

The coder MUST stay inside `archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/touch-set.json`. Citation: `{kind: lines, path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/touch-set.json, range: [1, 130], contentHash: TBD-on-commit}`.

## Execution Steps

1. When implementation starts, the coder MUST read the Spec, directive, operator response, ADR draft, and this plan before editing implementation files. Citations: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [1, 129], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/inbox/in/timestamp_naming_conventions.md, range: [11, 59], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md, range: [10, 87], contentHash: TBD-on-commit}`.
2. When policy encoding starts, the coder MUST create `lib/internal/tests/compliance/timestamp-naming-conventions.yaml` against `lib/internal/tests/compliance/schemas/latest.yaml`. The descriptor SHALL trigger on `structure-change` and `operator-on-demand`. Citation: `{kind: lines, path: AGENTS.md, range: [96, 101], contentHash: TBD-on-commit}`.
3. When Spec Contract authoring starts, the coder MUST create contract YAMLs under `lib/memory/features/timestamp-naming-conventions/contracts/` for the declared index identifiers. The contracts MUST anchor to Spec acceptance criteria. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [52, 112], contentHash: TBD-on-commit}`.
4. When the migration script is authored, the coder MUST implement convention helpers before file enumeration, rename planning, or writes. The helpers SHALL compute UTC day prefix, seconds-remaining prefix, `HHMM`, collision counter, semantic suffix, and in-scope status. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [54, 103], contentHash: TBD-on-commit}`.
5. When migration timestamp derivation runs, the migration MUST use this deterministic source order: first git commit timestamp, then frontmatter `created_at`, then filesystem `mtime`, then operator override. Git history is replayable and auditable across worktrees; frontmatter is artifact-local but not universal; `mtime` depends on checkout state; operator override is last because it introduces manual input. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [123, 129], contentHash: TBD-on-commit}`.
6. When migration planning runs, the script MUST perform a dry-run pass that inventories every in-scope source path, derived target path, collision counter, and reference update before any rename occurs. Citation: `{kind: lines, path: lib/inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md, range: [62, 77], contentHash: TBD-on-commit}`.
7. When migration writes run, the script MUST rename in-scope `work/` day directories, `work/` task directories, and in-scope inbox artifacts while preserving `work/*/run.log.jsonl` filenames and per-feature `lib/inbox/threads/` parent folders. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [60, 84], contentHash: TBD-on-commit}`.
8. When reference updates run, the script MUST inventory and update references that name migrated paths. The initial inventory SHALL include `lib/memory/features/compliance-tests/index.json`, `lib/memory/backlog/index.yaml`, and `archive/work/173009_04-27-26/68576_0457_compliance-tests/*.md`, then scan the repository for additional exact migrated paths. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [104, 109], contentHash: TBD-on-commit}`.
9. When handbook updates run, the coder MUST update `lib/memory/handbook/inbox-lifecycle.md` with the actor-ownership rule for non-conforming human-generated inbox artifacts. Citation: `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [110, 112], contentHash: TBD-on-commit}`.

## Verification Plan

- When compliance verification runs, the coder MUST run the timestamp naming descriptor through the compliance harness and include `pnpm run check:phase0a`, `pnpm lint`, and `pnpm typecheck`.
- When migration verification runs, the coder MUST run the migration in dry-run mode before write mode and spot-check at least 10 migrated paths or all migrated paths when fewer than 10 paths exist.
- When reference auditing runs, the coder MUST search for stale legacy path references after migration and record zero stale references or explicit deferrals.
- When rollback verification runs, the coder MUST prove the migration manifest can reverse every rename in last-write-first order.

## Risks And Rollback

- If policy lands after migration, then the repository MAY encode names that the gate later rejects. The coder MUST keep policy and Spec Contract work before migration writes.
- If timestamp derivation chooses a non-replayable source first, then repeated migrations MAY produce different basenames. The coder MUST use git commit timestamp before mutable filesystem metadata.
- If references are missed, then operators MAY follow stale paths. The coder MUST run the inventory pass before rename writes and the stale-reference audit after writes.
- If migration fails after partial writes, then the coder MUST use the migration manifest to reverse completed renames and rerun from a clean dry-run plan.
