# Implementation report — bootstrap de-hacking pass

**Task id.** `16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout`  
**Stage.** implement (must_fix re-entry)  
**Executor.** coder-standard

## Summary by work package

### WP-1 — Feature folder audit

- Relocated `m1-substrate-runtime-batch` to `src/memory/backlog/drafts/m1-substrate-runtime-batch.md`; deleted `src/memory/features/m1-substrate-runtime-batch/`.
- Added backlog item `m1-substrate-runtime-batch` (status `cancelled`) linking the shipped harness feature folder.
- Added `artifact_index.implementation_surface` on all 31 `keep-implemented` feature `index.json` files.
- Created `src/memory/features/bootstrap-phase-0a-closure/delivery-report.md` from verification evidence.
- Updated `src/memory/features/bootstrap-phase-0a-closure/index.json` with delivery report entry.
- Reconciled `src/memory/active/current.md` shipped table (removed non-keep-implemented `cli-operator-tooling-batch-*` row).
- Updated active feature `index.json` for implement stage and implementation-report artifact pointer.

### WP-2 — OPERATION.md extraction

- Created `OPERATION.md` with required sections (inbox, feature-delivery loop, CLI verbs, active memory, commit/policy-compliance, troubleshooting, librarian pre-close validation).
- Slimmed `README.md` to 52 lines with routes to `OPERATION.md`.
- Added `OPERATION.md` routes in `AGENTS.md`, `docs/M1.index.md`, and `src/memory/handbook/pancreator-config.md`.

### WP-3 — Operator-output conformance

- Created `operator-output-audit.md` with **full coverage matrices**: all 12 personas, 37 Cursor agents, 12 rule shims, 3 handbook pages with runnable examples (plus 16 handbook pages scanned by automation), and `AGENTS.md` / `README.md` / `OPERATION.md`.
- Fixed bare `pan` prose invocations in coder, intake-analyst, reviewer, supervisor, tech-lead, tech-writer, librarian personas.
- Added `src/internal/tools/check-operator-output.mjs` and `tests/operator-output-contract.test.mjs`.
- Updated `src/memory/handbook/operator-output-contract.md` with automated check reference.

### WP-4 — Backlog/debt consolidation

- Documented `tags: [debt]` in `src/memory/handbook/backlog-format.md`.
- Updated `src/memory/handbook/memory-tiers.md` to point debt tracking at backlog.
- Removed `/src/memory/debt/` from `AGENTS.md` workspace map.
- Surgically updated `docs/PRD.md` and `docs/PRD.index.md` for backlog-backed debt (M3 scope unchanged).
- Added backlog items: `m1-substrate-runtime-batch`, `bootstrap-ci-narrow-paths-re-enable`, `bootstrap-us7-tech-debt-scan` (`tags: [debt]`).

### WP-5 — CI slim and librarian gate

- Narrowed `.github/workflows/phase-0a-scaffold.yml` path filters (removed `src/work/**`, `src/internal/work_archive/**`; added `OPERATION.md`).
- Set `.github/workflows/run-logger-conformance.yml` to `workflow_dispatch` only.
- Added librarian pre-close validation duty in `src/personas/librarian.md` and `OPERATION.md`.

### WP-6 — Duplication sweep

- Created `duplication-inventory.md`; consolidated operator procedure into `OPERATION.md`.
- **must_fix re-entry:** added WP-6 **Category** column with required labels (`docs-vs-handbook`, `cli-help-vs-handbook`, `parallel-agent-projections`, `overlapping-feature-specs`) on every finding.
- No changes required to `context-economy.md`, `subagent-model-tiers.md`, `agents-md-authoring.md`, or CLI help (`run.ts` / `feature-delivery-run.ts`) per inventory.

## must_fix remediation (review re-entry)

| Review finding | Remediation |
|---|---|
| `duplication-inventory.md` missing WP-6 category labels | Added **Category** column; labeled all rows; added `parallel-agent-projections` and `overlapping-feature-specs` rows for projection mirrors and relocated m1 batch spec |
| `operator-output-audit.md` partial coverage evidence | Replaced sampling language with full enumeration tables (12 personas, 37 agents, 12 rules, handbook runnable pages + automation scan of remaining handbook files); recorded `check-operator-output.mjs` exit `0` |

**Touch-set alignment (consider).** `docs/PRD.summary.md` operation set to `modify-if-needed` to match deferral.

## Validation exit codes

Re-run after must_fix remediation:

| Command | Exit code |
|---|---|
| `node --test tests/*.test.mjs` | 0 |
| `node src/internal/tools/check-phase-0a-scaffold.mjs` | 0 |
| `node src/internal/tools/context-budget-report.mjs` | 0 |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | 0 |
| `node src/internal/tools/check-operator-output.mjs` | 0 |

## Deferrals

| Item | Rationale |
|---|---|
| `docs/PRD.summary.md` | README/OPERATION split does not change summary routing; `docs/PRD.index.md` updated instead |
| `src/memory/features/index.json` global index | No `m1-substrate-runtime-batch` row was present to remove |
| Handbook deferred-verb prose (`pan inbox archive`, etc.) | Not runnable blocks; existing backlog items cover automation |

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: "Operator procedure, workspace map, memory-tier policy, CI posture, persona duties, and validation tooling changed."
  changed-surfaces:
    - AGENTS.md
    - README.md
    - OPERATION.md
    - docs/M1.index.md
    - docs/PRD.index.md
    - docs/PRD.md
    - src/personas/librarian.md
    - src/personas/coder.md
    - src/personas/intake-analyst.md
    - src/personas/reviewer.md
    - src/personas/supervisor.md
    - src/personas/tech-lead.md
    - src/personas/tech-writer.md
    - src/memory/handbook/backlog-format.md
    - src/memory/handbook/memory-tiers.md
    - src/memory/handbook/operator-output-contract.md
    - src/memory/handbook/pancreator-config.md
    - src/memory/backlog/index.yaml
    - src/memory/active/current.md
  deferred-items: []
```

## Next operator steps

1. **What:** Accept the corrected implementation report and spot-check the two remediated audit artifacts.  
   **How:** Read-only: open `src/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/implementation-report.md`, `operator-output-audit.md`, and `duplication-inventory.md`.

2. **What:** Advance the run to review after accepting the implementation artifact.  
   **How:** Run:

   ```bash
   pnpm -w exec pan advance 16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout --artifact src/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/implementation-report.md
   ```

   Then delegate the regenerated `next-prompt.md` to `reviewer`.
