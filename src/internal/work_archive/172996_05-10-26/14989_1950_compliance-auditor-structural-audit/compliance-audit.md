# Compliance audit — structural conventions and context economy

## Scope contract

Declared trigger: operator-on-demand broad compliance audit after convention-centric repository restructuring.

`audit_interaction.mode`: `non_interactive`.

Run-log selector: none.

Exact audited path set:

- `AGENTS.md`
- `.cursor/hooks/enforce-policy-compliance.sh`
- `.cursor/rules/*.mdc`
- `.github/workflows/phase-0a-scaffold.yml`
- `docs/**`
- `src/internal/packages/**`
- `src/memory/handbook/**`
- `src/memory/backlog/index.yaml`
- `src/skills/**`
- `tests/**`

## Checks executed

- Ran `node --test tests/repo-structure.test.mjs` after remediation.
- Ran `node --test tests/*.test.mjs` after remediation.
- Ran `node src/internal/tools/check-phase-0a-scaffold.mjs` after remediation.
- Ran `node src/internal/tools/context-budget-report.mjs` after remediation.
- Searched live normative surfaces for stale two-level work placeholders with `/src/work/<id>/`, `/src/work/<task-id>/`, and `/src/work/*/run.log.jsonl`.
- Audited Cursor rule globs for broad `src/**/*` activation.
- Audited `.github/workflows/phase-0a-scaffold.yml` path triggers for changes to Cursor rules, hooks, and agent projections.
- Validated policy-compliance gate readiness by adding and checking `src/internal/work_archive/172996_05-10-26/14989_1950_compliance-auditor-structural-audit/policy-compliance.json` against `src/memory/handbook/policy-compliance-contract.md`.

## Findings

### block

- None.

### major

- The policy-compliance hook still admitted the legacy two-level `src/work/<task>/policy-compliance.json` shape after the repository had standardized on `src/work/<day>/<task>/policy-compliance.json`. Evidence: `.cursor/hooks/enforce-policy-compliance.sh` previously carried both legacy and canonical regex branches; `src/memory/backlog/index.yaml` already tracked `policy-compliance-hook-legacy-shape-removal` as deferred follow-up.
- Live normative surfaces still used stale two-level work placeholders. Evidence: `tests/compliance/high-remediation-blocking.yaml`, `src/skills/write-adr/SKILL.md`, `src/skills/modern-code-review/SKILL.md`, `src/skills/blameless-postmortem/SKILL.md`, `src/internal/packages/@pancreator/run-logger/README.md`, `docs/PRD.md`, and `src/memory/handbook/glossary.md` contained direct `src/work/<id>/`, `src/work/<task-id>/`, or `src/work/*/run.log.jsonl` references.

### minor

- `coder.mdc` included a broad `src/**/*` glob that caused the implementation persona to activate across most operating-corpus edits, which weakens the context-economy controls documented in `src/memory/handbook/context-economy.md` and `src/memory/handbook/context-cost-audit.md`. Evidence: `.cursor/rules/coder.mdc` contained the broad source-wide glob while `.cursorindexingignore` and the context-economy handbook try to keep internal operating content route-based.
- GitHub workflow path filters did not include `.cursor/rules/**`, `.cursor/hooks/**`, or `.cursor/agents/**`, so changes to Cursor control-plane files could miss the Phase 0a scaffold workflow. Evidence: `.github/workflows/phase-0a-scaffold.yml` watched `.cursorindexingignore` but not the Cursor rule, hook, or agent projection directories.
- The repository-structure test rejected every timestamped day directory under active work, even though compliance-auditor output and active runs are required to live under `src/work/<day>/<task-id>/` until librarian archival. Evidence: `tests/repo-structure.test.mjs` asserted no `src/work/<day>` directory could exist while `src/personas/compliance-auditor.md` requires `/src/work/<day>/<id>/compliance-audit.md` and `/src/work/<day>/<id>/compliance-remediation.md`.

### note

- Dependency-backed lint, build, typecheck, publint, and are-the-types-wrong were not executed because the uploaded zip did not include `node_modules` and the container could not download pnpm packages. Direct Node tests and scripts that do not require installed dependencies were executed.

## Auto-remediations applied

- Removed the legacy two-level policy-compliance regex branch from `.cursor/hooks/enforce-policy-compliance.sh`; risk is low because the repository had already standardized on the three-level work shape and an existing backlog item requested this exact removal.
- Replaced live two-level work placeholders with `src/work/<day>/<id>/`, `src/work/<day>/<task-id>/`, or `src/work/*/*/run.log.jsonl` as appropriate; risk is low because this is reference alignment with the existing timestamp-naming convention.
- Narrowed `.cursor/rules/coder.mdc` from broad `src/**/*` activation to implementation package, test, tool, and explicit touch-set paths; risk is medium because Cursor rule activation changes can affect invocation ergonomics.
- Added `.cursor/agents/**`, `.cursor/hooks/**`, and `.cursor/rules/**` to the Phase 0a workflow path filters; risk is low because the workflow already covers adjacent governance surfaces.
- Updated `tests/repo-structure.test.mjs` to allow active work day directories when their days-to-FDS prefix is correct, and added regression coverage for three-level placeholders, policy hook shape, and broad Cursor rule globs; risk is low.
- Updated `src/memory/handbook/context-cost-audit.md` to record the broad-rule cost control and current root-tests layout; risk is low.
- Marked the existing `policy-compliance-hook-legacy-shape-removal` backlog item as `done`; risk is low because the hook removal and regression test land in the same patch.

## Documentation-impact decision

Documentation impact applies.

Updated documentation and reference surfaces:

- `docs/PRD.md`
- `src/memory/handbook/glossary.md`
- `src/memory/handbook/context-cost-audit.md`
- `src/memory/features/timestamp-naming-conventions/spec.md`
- `src/memory/features/timestamp-naming-conventions/delivery-report.md`
- `src/memory/features/cursor-token-economy/spec.md`
- `src/memory/features/active-memory-context-economy-pass-2/spec.md`
- `src/memory/backlog/index.yaml`

No new deferred documentation item is required. Existing broad citation-hash and citation-range refresh work remains tracked by `bootstrap-content-hash-refresh` and `citation-range-realignment-pass` in `src/memory/backlog/index.yaml`.

## Proposal decisions

No new policy or structure proposal is emitted. This audit applied deterministic remediations for already-ratified conventions and closed one existing backlog item.

## Gate recommendation

`compliance_passes: true`.

Predicate summary: the audited structural convention issues were remediated, regression tests now cover the fixed controls, and all direct Node validation gates available in the container pass.
