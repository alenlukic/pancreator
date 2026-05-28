# ADR Draft — Simplify Bootstrap Operations, Memory Layout, And Validation

## Status

Proposed for human ratification at the `plan_ratification` gate for task `16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout`.

## Context

Bootstrap Phase 5 keeps a human-gated `feature-delivery` loop while the repository already contains durable Feature memory, persona contracts, handbook policy, CI workflows, and local validation tools. The current operator entry point duplicates runtime procedure in `README.md`, `AGENTS.md`, and handbook pages; the memory map still names `src/memory/debt/` even though the path does not exist; and CI runs broad bootstrap checks on generated active-work changes.

ADR-0001 establishes `src/memory/backlog/index.yaml` as the canonical open and deferred work index at `{kind: lines, path: src/memory/adr/0001-backlog-tracking.md, range: [74, 81], contentHash: e36b188}`. ADR-0002 requires architecture-facing docs to distinguish current repository substrate from future runtime claims at `{kind: lines, path: src/memory/adr/0002-system-architecture-map.md, range: [137, 151], contentHash: e037427}`. The active spec requires OPERATION extraction, debt consolidation, operator-output enforcement, feature-folder disposition, CI slimming, and librarian pre-close validation at `{kind: lines, path: src/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/spec.md, range: [120, 127], contentHash: 44c42d2}`.

## Decision

Daedaline SHALL use `OPERATION.md` as the canonical operator how-to. `README.md` SHALL remain the short repository entry point. `AGENTS.md` SHALL keep cross-tool operating policy and route operators to `OPERATION.md` for procedural loops.

Daedaline SHALL retire `src/memory/debt/` as a bootstrap memory tier. Debt SHALL be encoded in `src/memory/backlog/index.yaml` with `tags: [debt]`. This decision preserves one backlog schema while allowing debt filtering without a second durable directory.

Daedaline SHALL keep Feature folders only when they have an implemented surface, a ratified evidence bundle, or an active-run exception. The implementation stage SHALL relocate `m1-substrate-runtime-batch` to backlog draft storage because its successor `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` has shipped the runtime batch evidence.

Daedaline SHALL make local librarian pre-close validation the default quality gate for active runs. CI SHALL remain available but bootstrap-generated run artifacts SHALL not trigger the heavy default workflow. Run-logger conformance SHALL move to `workflow_dispatch` until the re-enable trigger is ratified.

Daedaline SHALL enforce runnable `ddl` examples with an automated check that requires the `pnpm -w exec ddl` prefix in operator-visible code blocks.

## Consequences

- Positive: Operators get one procedural home, and README token load drops.
- Positive: Debt tracking uses one ranked backlog and one schema.
- Positive: Feature memory keeps implemented evidence and moves superseded intake skeletons out of the Feature tier.
- Positive: The librarian pre-close gate gives humans a deterministic local validation point before archive closure.
- Negative: The implementation stage must update many indexes and citations in one coordinated pass.
- Negative: Future M3 debt-scan docs must refer to backlog-backed debt items unless a later ratified ADR restores a separate debt directory.
- Neutral: This decision does not automate Cursor delegation, remove human gates, change Bootstrap Phase 5 status, or build the operator dashboard.
