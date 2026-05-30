---
title: Repository Layout Restructure and Archive Migration — Engineering Spec
feature_id: repository-layout-restructure-and-archive-migration
status: intake
source_inbox_item: lib/inbox/in/172976_05-30-26/65996_0540_repo-layout-restructure.md
references:
  - kind: path
    path: lib/inbox/in/172976_05-30-26/65996_0540_repo-layout-restructure.md
    note: Operator directive with all intake-round-0 decisions ratified; canonical requirement source for this Feature.
  - kind: lines
    path: AGENTS.md
    range: [231, 269]
    contentHash: b8b1d4a
    note: Workspace map lists current canonical path contracts for every durable and transient surface targeted by this migration.
  - kind: lines
    path: AGENTS.md
    range: [139, 148]
    contentHash: b8b1d4a
    note: Documented durable directories are materialized on demand; governs directory-creation obligations during migration.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [67, 77]
    contentHash: 80c7e67
    note: Canonical inbox path contracts including archive/in/ location and operator-sandbox exclusion rule.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [54, 76]
    contentHash: 94a67b5
    note: Ratified UTC, FDS, SID, and day-bucket naming tokens used by inbox/work paths being migrated.
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [60, 76]
    contentHash: afdc2a6
    note: Layer 1 requires one RFC 2119 keyword and one EARS form per normative clause.
---

# Spec

This Feature SHALL execute a one-shot, auditable repository layout restructure that consolidates archives under a top-level `archive/` directory, relocates transient active work to a top-level `work/` directory, colocates skill packs under `lib/personas/skills/`, renames the entire `lib/` tree to `lib/`, simplifies `.cursor/agents/` to one file per persona, retires standard/complex tier policy, and performs a repository-wide reference sweep. The Feature covers seven work packages (WP-1 through WP-7). All operator decisions recorded in the source directive are ratified; there are no open clarifying questions.

## WP-1 — Top-level `archive/` and archive migrations

The Feature SHALL create a top-level `archive/` directory as the canonical home for archived operational artifacts.

When the Feature migrates inbox archive artifacts, the Feature SHALL relocate all contents of `archive/inbox/` to `archive/inbox/` while preserving every day-bucket directory and every leaf file at its relative sub-path.

When the Feature migrates work archive artifacts, the Feature SHALL relocate all contents of `archive/work/` to `archive/work/` while preserving every task-bucket directory and every artifact at its relative sub-path.

The Feature SHALL update every runtime reference and every documented reference that points to `archive/inbox/` or `archive/work/` to point to the corresponding new canonical path.

The Feature SHALL NOT create transitional compatibility aliases, symlinks, or fallback path resolvers for any archived path.

## WP-2 — Move transient work root to top-level `work/`

The Feature SHALL move `work/` to top-level `work/` as the canonical root for active run state.

The Feature SHALL update every script, documentation page, CLI help text, and policy contract that references `work/**` to reference `work/**` instead.

The Feature SHALL preserve every active-work discoverability guarantee currently provided by `pan run`, `pan advance`, and closure tooling after relocating `work/` to `work/`.

When archival or closure handoff paths are evaluated after migration, the Feature SHALL ensure active-work artifacts reside under `work/<day>/<task-id>/` and closed-run artifacts reside under `archive/work/<day>/<task-id>/`.

## WP-3 — Relocate skills under personas namespace

For every skill pack presently under `lib/personas/skills/`, the Feature SHALL relocate `lib/personas/skills/<name>/SKILL.md` to `lib/personas/skills/<name>/SKILL.md`, preserving the relative internal structure of each skill pack.

The Feature SHALL update every documentation page, rule glob, and agent runtime surface that currently references `lib/personas/skills/**/SKILL.md` to reference `lib/personas/skills/**/SKILL.md`.

The Feature SHALL NOT merge skill content into persona spec files; each skill pack SHALL remain a separate `SKILL.md` file colocated under the `lib/personas/skills/` tree.

## WP-4 — Rename `lib/` tree to `lib/`

The Feature SHALL rename the entire `lib/` directory to `lib/`, applying the canonical path mapping in the table below for every subtree not explicitly relocated by WP-1, WP-2, or WP-3.

The canonical path mapping SHALL be:

| Former path | New canonical path |
|---|---|
| `lib/inbox/in/` | `lib/inbox/in/` |
| `lib/inbox/out/` | `lib/inbox/out/` |
| `lib/inbox/threads/` | `lib/inbox/threads/` |
| `lib/inbox/notes/` | `lib/inbox/notes/` |
| `archive/inbox/` | `archive/inbox/` |
| `archive/work/` | `archive/work/` |
| `work/` | `work/` |
| `lib/personas/skills/` | `lib/personas/skills/` |
| All other `lib/**` | `lib/**` (same relative path) |

After migration completes, the `lib/` directory SHALL NOT exist in the working tree.

The Feature SHALL update all path references across docs, scripts, tests, configs, rules, fixtures, and client code so no normative contract depends on a stale `lib/` location.

The Feature SHALL preserve content integrity and directory semantics for every migrated branch of the tree.

## WP-5 — Simplify `.cursor/agents/` definitions

The Feature SHALL remove every `-standard` and `-complex` projection variant from `.cursor/agents/`, leaving zero files matching `.cursor/agents/*-standard.md` or `.cursor/agents/*-complex.md`.

The Feature SHALL retain exactly one canonical agent file per persona at `.cursor/agents/<name>.md`, using the model policy currently encoded in each persona's corresponding `-standard` variant.

The Feature SHALL retire `lib/memory/handbook/subagent-model-tiers.md` (path after WP-4 rename) by removing the file.

The Feature SHALL remove AGENTS.md section 4 standard/complex routing prose so that section 4 contains no reference to `-standard`, `-complex`, or tier escalation variant selection.

The Feature SHALL NOT introduce a replacement tier abstraction in this delivery slice.

The Feature SHALL update every documentation page, rule, and cross-reference that mentions `-standard`, `-complex`, or tier escalation behavior.

When the Feature verifies persona invocation after migration, every persona invocation token SHALL resolve to exactly one canonical file at `.cursor/agents/<name>.md`.

## WP-6 — Documentation and reference sweep

The Feature SHALL perform a full documentation and reference sweep for every path and policy change introduced by WP-1 through WP-5.

The sweep SHALL cover: AGENTS.md, all handbook pages under `lib/memory/handbook/`, all memory feature specs under `lib/memory/features/`, all ADRs under `lib/memory/adr/`, CLI path help text, compliance fixtures under `tests/compliance/`, all `.cursor/rules/` glob patterns, `client/` path consumers, `docs/`, and `tests/`.

The Feature SHALL apply the documentation-impact contract and record explicit deferral rationale with backlog linkage for every intentionally postponed reference update.

The Feature SHALL produce a migration report that enumerates every changed path, every updated reference, and the final validation result for each work package.

## WP-7 — Migration scripts with dry-run and pipeline execution

The Feature SHALL author maintenance scripts under `lib/internal/tools/` (the post-rename location equivalent to the current `lib/internal/tools/`) that perform the WP-1 through WP-4 tree moves and the WP-6 bulk reference rewrites.

Each migration script SHALL support a `--dry-run` mode that prints every planned move and every planned reference change without modifying the working tree.

Each migration script SHALL support a validation mode that asserts: no stale `lib/` references remain for migrated surfaces; the canonical path mapping table is satisfied; all required top-level directories exist.

The feature-delivery pipeline SHALL present dry-run output for operator review before running apply mode.

When the operator approves dry-run output within the delivery run, the migration scripts SHALL execute apply mode automatically without requiring manual `git mv` steps.

Migration scripts SHALL use `git mv` for all tree relocations where Git history preservation applies.

## Acceptance criteria

### WP-1

- When migration completes, `archive/inbox/` MUST contain all artifacts formerly under `archive/inbox/` with preserved day-bucket and leaf naming.
- When migration completes, `archive/work/` MUST contain all artifacts formerly under `archive/work/` with preserved task-bucket organization.
- The Feature MUST NOT retain any operational command, handbook contract, or spec that references `archive/inbox/` or `archive/work/` as a canonical path.
- The Feature MUST NOT create any compatibility shim, symlink, or alias for old archive paths.

### WP-2

- When migration completes, top-level `work/` MUST be the sole active-work canonical root; `work/` MUST NOT exist.
- Every CLI help string, documentation page, and policy contract that references active-work paths MUST resolve to `work/**`.
- The `pan run`, `pan advance`, and `pan close-artifacts` commands MUST remain functional against the new root without manual path overrides.

### WP-3

- Every former `lib/personas/skills/<name>/SKILL.md` MUST exist at `lib/personas/skills/<name>/SKILL.md` after migration.
- Zero normative contracts SHALL retain a reference to `lib/personas/skills/` after migration.
- Every agent and rule routing surface that depends on skill paths MUST remain operational after migration and MUST be documented at the new path.

### WP-4

- The `lib/` directory MUST NOT exist in the working tree after migration; its former contents MUST reside under `lib/` or another explicitly defined target directory per the canonical path mapping table.
- Zero normative docs, specs, or contracts SHALL retain a stale `lib/` reference for any migrated surface.
- The canonical path mapping table in WP-4 MUST be fully satisfied with no row left unmigrated.

### WP-5

- Each persona MUST have exactly one canonical file at `.cursor/agents/<name>.md`; zero `-standard` or `-complex` variants SHALL remain.
- Each canonical agent file MUST encode the model policy that was previously in the persona's `-standard` variant.
- `lib/memory/handbook/subagent-model-tiers.md` MUST be removed; zero normative routing references to standard/complex variant selection SHALL remain in AGENTS.md or any handbook page.
- AGENTS.md section 4 MUST NOT contain prose referencing standard/complex variant selection after the update.

### WP-6

- A documentation and reference sweep MUST cover all surfaces listed in the WP-6 sweep scope above.
- Zero canonical operator-facing contracts SHALL point to pre-migration paths after the sweep.
- The documentation-impact review MUST be present with explicit deferral rationale for every non-updated but affected surface.
- The migration report MUST enumerate every changed path, every updated reference, and every validation result.

### WP-7

- Every migration script MUST implement `--dry-run` and validation modes.
- Dry-run output MUST be presented for operator review before apply mode executes in the delivery run.
- Apply mode MUST complete the one-shot migration without requiring manual `git mv` steps beyond operator approval of dry-run output.

### Cross-cutting completion gate

The delivery SHALL NOT be accepted until all of the following conditions are satisfied:

1. `pnpm test` exits with code 0.
2. The compliance test suite under `tests/compliance/` passes against `tests/compliance/schemas/latest.yaml`.
3. `pan run`, `pan advance`, and `pan close-artifacts` each complete a smoke execution against the new canonical paths.
4. Documentation lint passes with zero Layer 1 violations and zero unresolved stale-path citations.
5. The client dev server starts and serves without path-resolution errors.

## Out of scope

- Feature behavior changes unrelated to path or layout migration, including business logic, runtime semantics, or persona authority redesign.
- Re-architecture of inbox lifecycle semantics beyond path relocation.
- Deletion of historical artifacts without a defined archive destination.
- Opportunistic refactors not required to complete this migration contract.
- Removal of transient surfaces from the Git index (follow-on work enabled by this reorg).
- Any replacement tier-abstraction policy after retiring standard/complex routing.
- Phased rollout with intermediate compatibility windows.
- Backward-compatibility shims of any kind.
- Merging skill content into persona spec files.

## Open questions

None. The operator ratified all decisions in intake round 0. See the source directive for the full decision table.
