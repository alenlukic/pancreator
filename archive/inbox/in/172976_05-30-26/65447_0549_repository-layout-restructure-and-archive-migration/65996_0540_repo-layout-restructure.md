---
title: Repository layout restructure and archive migration
feature_id: repo-layout-restructure
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-30T05:40:03.896Z
operator_ratification:
  channel: operator_cursor_chat
  ratified_at: 2026-05-30
  note: Operator answered all open questions in intake round 0; see Operator decisions below.
references:
  - kind: path
    path: lib/inbox/notes/repo-layout.md
    note: Original operator draft; promotion source for this directive.
  - kind: path
    path: lib/memory/handbook/inbox-lifecycle.md
    note: Canonical inbox queue naming, SID/HHMM day-bucket conventions, and archive expectations.
  - kind: path
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    note: Timestamp-prefix and naming policy used by intake file creation and migration safety checks.
  - kind: path
    path: AGENTS.md
    note: Current workspace map, path contracts, protected surfaces, and delegation/tier references.
  - kind: path
    path: lib/memory/handbook/subagent-model-tiers.md
    note: Standard/complex tier policy to be retired per operator decision.
  - kind: path
    path: lib/memory/handbook/documentation-impact-contract.md
    note: Requires post-change documentation impact assessment and explicit deferral rationale when needed.
---

# Repository layout restructure and archive migration

## Problem

The repository path topology mixes durable source surfaces and transient runtime
artifacts under `lib/`, while archival and agent-definition layouts diverge from
the operator's intended information architecture.

Specifically:

1. **Transient vs durable conflation.** Active run workspaces (`work/`) and
   archived run artifacts (`archive/work/`) live under the same
   `lib/` root as durable library surfaces (personas, handbook, pipelines).
   Subsequent work will remove some transient surfaces from the Git index; this
   reorg establishes the separation required for that follow-on.
2. **Adopt/greenfield readiness.** Path conventions that conflate library canon
   with operator runtime state impede clean adoption of external targets and
   greenfield initialization where `lib/` vs `work/` vs `archive/` must be
   distinguishable.
3. **Operator UX.** Archive locations split across `lib/inbox/archive` and
   `lib/internal/work_archive` force operators to hunt across unrelated trees.
   Agent projection sprawl (`-standard`/`-complex` pairs) adds invocation
   friction without proportional benefit at current bootstrap maturity.

Current path contracts, automation scripts, docs, and agent projections encode
the existing structure. A structural migration without a coordinated spec risks
breaking CLI workflows, policy contracts, rule globs, citations, compliance
descriptors, and downstream tooling.

## Goal

Deliver a one-shot, auditable repository layout restructure that:

1. Consolidates archives under top-level `archive/`.
2. Moves transient active work to top-level `work/`.
3. Colocates skills under `lib/personas/skills/`.
4. Renames the entire `lib/` tree to `lib/`.
5. Simplifies `.cursor/agents/` to one file per persona.
6. Retires standard/complex tier policy documentation.
7. Updates every path reference across the repository (including `client/`,
   `docs/`, `tests/`, compliance fixtures, and CLI surfaces).
8. Executes via maintenance scripts with dry-run validation before apply.

## Operator decisions (intake round 0 — ratified)

The operator resolved all prior open questions as follows:

| # | Decision |
|---|---|
| 1 | Skills destination: nested tree at `lib/personas/skills/<name>/SKILL.md`. |
| 2 | `lib/` → `lib/` applies to **every** former `lib/*` subtree. |
| 3 | Default rule: rename `src` to `lib`; relative structure unchanged unless this directive explicitly states otherwise. Inbox active surfaces become `lib/inbox/in/`, `lib/inbox/out/`, `lib/inbox/threads/`, `lib/inbox/notes/`. |
| 4 | All path references MUST be updated repository-wide, including `client/` and other top-level directories. Exception: `lib/internal/work_archive` content moves to `archive/work/` (not renamed in place). |
| 5 | Delivery: **one-shot** atomic migration in a single delivery slice. |
| 6 | Tooling: maintenance scripts with dry-run + validation; scripts run automatically in the feature-delivery pipeline once dry-run output is operator-approved. |
| 7 | Agent tiers: **retire** `subagent-model-tiers.md` and AGENTS section 4 standard/complex routing; no replacement tier abstraction in this slice. |
| 8 | Compatibility: **no** transition shims (no symlinks, alias loaders, re-exports, or fallback path resolvers). |
| 9 | Completion gate: `pnpm test`, compliance suite, `pan run`/`pan advance`/`pan close-artifacts` smoke, documentation lint, and client dev server MUST all pass. |

## Required outcomes

### WP-1 — Top-level `archive/` and archive migrations

1. The implementation SHALL create a top-level `archive/` directory as the
   canonical home for archived operational artifacts.
2. The implementation SHALL migrate `lib/inbox/archive` to `archive/inbox`
   while preserving queue semantics and relative leaf naming.
3. The implementation SHALL migrate `lib/internal/work_archive` to
   `archive/work` while preserving archived task buckets and artifact contents.
4. The implementation SHALL update all runtime/documented references that point
   to either old archive path.
5. The implementation SHALL NOT create transitional compatibility aliases.

### WP-2 — Move transient work root to top-level `work/`

1. The implementation SHALL move `lib/work` to top-level `work/` because active
   run state is transient runtime material, not library source.
2. The implementation SHALL update all scripts, docs, CLI/help text, and policy
   contracts that currently reference `work/**`.
3. The implementation SHALL preserve active-work discoverability guarantees
   currently used by `pan run`, `pan advance`, and closure tooling.
4. The implementation SHALL ensure archival/closure handoff paths remain
   coherent after the move (active work under `work/`; closed runs under
   `archive/work/`).

### WP-3 — Relocate skills under personas namespace

1. The implementation SHALL move `lib/personas/skills/<name>/SKILL.md` to
   `lib/personas/skills/<name>/SKILL.md` for every existing skill pack.
2. The implementation SHALL preserve skill discoverability for all agent
   runtime surfaces that currently read `lib/personas/skills/**/SKILL.md`.
3. The implementation SHALL update all documentation, rules, and references
   that currently treat `lib/personas/skills/` as top-level canon.
4. The implementation SHALL NOT merge skill content into persona spec files;
   skills remain separate `SKILL.md` packs colocated under the personas tree.

### WP-4 — Rename `lib/` tree to `lib/`

1. The implementation SHALL rename the entire `lib/` directory to `lib/`,
   preserving relative structure for every subtree not explicitly relocated by
   WP-1, WP-2, or WP-3.
2. After WP-1 through WP-3 complete, the following canonical path mapping
   SHALL apply:

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

3. The implementation SHALL update path references across docs, scripts, tests,
   configs, rules, fixtures, and client code so no normative contract depends
   on stale `lib/` locations.
4. The implementation SHALL preserve content integrity and directory semantics
   for every migrated branch of the tree.

### WP-5 — Simplify `.cursor/agents` definitions

1. The implementation SHALL remove every `-standard` and `-complex` projection
   variant from `.cursor/agents/`.
2. The implementation SHALL retain exactly one canonical agent file per persona
   at `.cursor/agents/<name>.md`, using the model policy currently encoded in
   each persona's `-standard` variant.
3. The implementation SHALL retire `lib/memory/handbook/subagent-model-tiers.md`
   and remove AGENTS.md section 4 standard/complex routing prose; no replacement
   tier abstraction is in scope for this slice.
4. The implementation SHALL update all docs, rules, and references that mention
   `-standard`, `-complex`, or tier escalation behavior.
5. The implementation SHALL verify that persona invocation tokens resolve to
   the canonical single-file definitions after migration.

### WP-6 — Documentation and reference sweep

1. The implementation SHALL perform a full documentation and reference sweep for
   path and policy changes introduced by WP-1 through WP-5.
2. The sweep SHALL include AGENTS.md, handbook pages, memory feature specs, ADRs,
   CLI path help, compliance fixtures, `client/` path consumers, `docs/`,
   `tests/`, and `.cursor/rules/` globs.
3. The implementation SHALL apply the documentation-impact contract and record
   explicit deferrals for any intentionally postponed updates.
4. The implementation SHALL produce a migration report enumerating changed paths,
   updated references, and validation results.

### WP-7 — Migration scripts with dry-run and pipeline execution

1. The implementation SHALL author maintenance scripts under
   `lib/internal/tools/` (or equivalent post-rename location) that perform the
   WP-1 through WP-4 tree moves and WP-6 bulk reference rewrites.
2. Each script SHALL support a `--dry-run` mode that prints planned moves and
   reference changes without modifying the working tree.
3. Each script SHALL support a validation mode (or separate validator) that
   asserts: no stale `lib/` references remain for migrated surfaces; canonical
   path mapping table is satisfied; required directories exist.
4. The feature-delivery pipeline SHALL run dry-run output for operator review
   before apply; apply mode SHALL execute automatically once dry-run output is
   operator-approved within the delivery run.
5. Scripts SHALL use `git mv` (or equivalent history-preserving moves) for tree
   relocations where Git history preservation is applicable.

## Acceptance criteria

### WP-1 acceptance criteria

1. `archive/inbox/` MUST contain all artifacts formerly under
   `archive/inbox/` with preserved day-bucket and leaf naming semantics.
2. `archive/work/` MUST contain all artifacts formerly under
   `archive/work/` with preserved task-bucket organization.
3. No operational command, handbook contract, or spec SHALL reference
   `archive/inbox/` or `archive/work/` as canonical paths.
4. No compatibility shims for old archive paths SHALL exist.

### WP-2 acceptance criteria

1. Top-level `work/` MUST replace `work/` as the active-work canonical root.
2. CLI/help/docs/contracts that reference active-work paths SHALL resolve to
   `work/**`.
3. Active run lifecycle behaviors (create, advance, close) MUST remain
   functional against the new root.

### WP-3 acceptance criteria

1. Every former `lib/personas/skills/<name>/SKILL.md` MUST exist at
   `lib/personas/skills/<name>/SKILL.md`.
2. No orphaned references to `lib/personas/skills/` SHALL remain in normative contracts.
3. Agent/rule routing semantics that depend on skill paths MUST remain
   operational and documented.

### WP-4 acceptance criteria

1. The `lib/` directory MUST NOT exist after migration; its former contents MUST
   reside under `lib/` (except paths explicitly relocated by WP-1, WP-2, WP-3).
2. Normative docs/specs/contracts SHALL NOT retain stale `lib/` references for
   migrated surfaces.
3. The path mapping table in WP-4 required outcome 2 MUST be satisfied.

### WP-5 acceptance criteria

1. Each persona MUST have exactly one `.cursor/agents/<name>.md` file; zero
   `-standard` or `-complex` variants SHALL remain.
2. Canonical agent definitions MUST preserve current `-standard` model behavior.
3. `subagent-model-tiers.md` MUST be retired (removed or marked deprecated with
   zero normative routing references remaining in AGENTS or handbook).
4. AGENTS.md section 4 MUST NOT reference standard/complex variant selection.

### WP-6 acceptance criteria

1. A documentation/reference sweep MUST update all surfaces listed in WP-6
   required outcome 2.
2. No canonical operator-facing contract SHALL point to pre-migration paths.
3. Documentation-impact review MUST be present with explicit deferral rationale
   for any non-updated but affected surface.

### WP-7 acceptance criteria

1. Migration scripts MUST implement `--dry-run` and validation modes.
2. Dry-run output MUST be reviewable before apply executes in the delivery run.
3. Apply mode MUST complete the one-shot migration without manual `git mv` steps
   beyond operator approval of dry-run output.

### Cross-cutting completion gate

The delivery SHALL NOT be accepted until all of the following pass:

1. `pnpm test`
2. Compliance test suite (`tests/compliance/` against latest schema)
3. `pan run` / `pan advance` / `pan close-artifacts` smoke against the new paths
4. Documentation lint (Layer 1 contracts, citation integrity)
5. Client dev server starts and serves without path-resolution errors

## Out of scope

1. Feature behavior changes unrelated to path/layout migration (business logic,
   runtime semantics, or persona authority redesign).
2. Full re-architecture of inbox lifecycle semantics beyond path relocation.
3. Silent deletion of historical artifacts without defined archive destination.
4. Opportunistic refactors not required to complete this migration contract.
5. Removing transient surfaces from the Git index (follow-on work enabled by
   this reorg, not part of this slice).
6. Replacement tier-abstraction policy after retiring standard/complex routing.

## Non-goals

1. Phased rollout with intermediate compatibility windows.
2. Backward-compatibility shims of any kind.
3. Merging skill content into persona spec files.

## Open questions

None. Operator ratified all decisions in intake round 0 (see Operator decisions).

## Human ratification required

Human ratification SHALL be required before intake closure because this request
touches protected and high-blast-radius surfaces:

1. AGENTS routing map and policy contracts (including section 4 retirement).
2. `.cursor/agents` model-tier conventions and persona invocation surfaces.
3. Canonical inbox/archive/work path contracts used across docs, scripts, and
   compliance workflows.
4. Repository-wide root rename (`lib/` to `lib/`) with cross-cutting impact.

Operator round-0 answers above satisfy the clarifying-question loop; remaining
ratification is confirmation that protected-surface edits in the canonical spec
are authorized to proceed to plan stage.
