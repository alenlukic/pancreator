# ADR Draft — One-Shot Canonical Repository Layout Migration

## Status

Draft for human ratification at the `plan` stage.

## Context

The feature contract requires one migration slice that moves archival artifacts to `archive/`, active run artifacts to `work/`, and source artifacts to `lib/`, with skill packs under `lib/personas/skills/`. The contract also requires removing `.cursor/agents` tier variants and retiring tier-policy documentation in the same delivery slice. Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [41, 110], contentHash: "pending-refresh"}` and `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [121, 133], contentHash: "pending-refresh"}`.

ADR-0003 defines inbox lifecycle and archival boundaries that this migration re-roots at `archive/inbox/` while preserving lifecycle semantics and operator sandbox rules. Citation: `{kind: lines, path: "lib/memory/adr/0003-inbox-lifecycle-and-archival.md", range: [52, 109], contentHash: "pending-refresh"}`.

ADR-0006 defines active versus archival memory distinctions. This migration enforces that distinction physically by separating transient `work/` from archival `archive/work/` and by updating contracts that currently point into `lib/**`. Citation: `{kind: lines, path: "lib/memory/adr/0006-active-vs-archival-memory.md", range: [1, 164], contentHash: "pending-refresh"}`.

## Decision

The implementation SHALL use scripted, deterministic migration tooling to execute tree moves and reference rewrites in one operator-approved run.

The implementation SHALL run dry-run first and SHALL require explicit operator approval before apply mode.

The implementation SHALL use `git mv` for relocations where Git history preservation applies.

The implementation SHALL not ship compatibility shims, alias resolvers, symlinks, or phased fallback routes.

The implementation SHALL produce and run a validation script that fails when stale canonical references remain, required post-migration directories are missing, or mapping rows are incomplete.

The implementation SHALL remove tiered agent projection files and tiered routing documentation without introducing a replacement tier abstraction in this slice.

## Consequences

- Positive: Canonical path contracts become consistent across runtime, docs, and policy surfaces.
- Positive: Active and archival work roots become explicit and auditable.
- Positive: One-file-per-persona projection policy reduces agent routing complexity.
- Negative: The migration has wide blast radius across docs, rules, tests, and runtime helpers.
- Negative: The delivery requires careful sequencing to avoid temporary path breakage during apply mode.
- Neutral: Existing workspace drift outside the touch-set remains out of scope and must be preserved.

## Rejected Alternatives

- **Phased migration with temporary aliases.** Rejected because the spec forbids compatibility shims and expects one-shot completion.
- **Retain `lib/` and create a parallel `lib/` tree.** Rejected because the spec requires `lib/` removal after migration.
- **Keep `-standard` and `-complex` files while adding canonical aliases.** Rejected because the spec requires zero remaining variant files.

## References

- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [41, 133], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [135, 190], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/adr/0003-inbox-lifecycle-and-archival.md", range: [52, 109], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/adr/0006-active-vs-archival-memory.md", range: [1, 164], contentHash: "pending-refresh"}`
- `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [1, 407], contentHash: "pending-refresh"}`
