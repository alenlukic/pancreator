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
- `lib/internal/packages/**`
- `lib/memory/handbook/**`
- `lib/memory/backlog/index.yaml`
- `lib/personas/skills/**`
- `tests/**`

## Checks executed

- Ran `node --test tests/repo-structure.test.mjs` after remediation.
- Ran `node --test tests/*.test.mjs` after remediation.
- Ran `node lib/internal/tools/check-phase-0a-scaffold.mjs` after remediation.
- Ran `node lib/internal/tools/context-budget-report.mjs` after remediation.
- Searched live normative surfaces for stale two-level work placeholders with `/work/<id>/`, `/work/<task-id>/`, and `/work/*/run.log.jsonl`.
- Audited Cursor rule globs for broad `lib/**/*` activation.
- Audited `.github/workflows/phase-0a-scaffold.yml` path triggers for changes to Cursor rules, hooks, and agent projections.
- Validated policy-compliance gate readiness by adding and checking `archive/work/172996_05-10-26/14989_1950_compliance-auditor-structural-audit/policy-compliance.json` against `lib/memory/handbook/policy-compliance-contract.md`.

## Findings

### block

- None.

### major

- The policy-compliance hook still admitted the legacy two-level `work/<task>/policy-compliance.json` shape after the repository had standardized on `work/<day>/<task>/policy-compliance.json`. Evidence: `.cursor/hooks/enforce-policy-compliance.sh` previously carried both legacy and canonical regex branches; `lib/memory/backlog/index.yaml` already tracked `policy-compliance-hook-legacy-shape-removal` as deferred follow-up.
- Live normative surfaces still used stale two-level work placeholders. Evidence: `tests/compliance/high-remediation-blocking.yaml`, `lib/personas/skills/write-adr/SKILL.md`, `lib/personas/skills/modern-code-review/SKILL.md`, `lib/personas/skills/blameless-postmortem/SKILL.md`, `lib/internal/packages/@pancreator/run-logger/README.md`, `docs/PRD.md`, and `lib/memory/handbook/glossary.md` contained direct `work/<id>/`, `work/<task-id>/`, or `work/*/run.log.jsonl` references.

### minor

- `coder.mdc` included a broad `lib/**/*` glob that caused the implementation persona to activate across most operating-corpus edits, which weakens the context-economy controls documented in `lib/memory/handbook/context-economy.md` and `lib/memory/handbook/context-cost-audit.md`. Evidence: `.cursor/rules/coder.mdc` contained the broad source-wide glob while `.cursorindexingignore` and the context-economy handbook try to keep internal operating content route-based.
- GitHub workflow path filters did not include `.cursor/rules/**`, `.cursor/hooks/**`, or `.cursor/agents/**`, so changes to Cursor control-plane files could miss the Phase 0a scaffold workflow. Evidence: `.github/workflows/phase-0a-scaffold.yml` watched `.cursorindexingignore` but not the Cursor rule, hook, or agent projection directories.
- The repository-structure test rejected every timestamped day directory under active work, even though compliance-auditor output and active runs are required to live under `work/<day>/<task-id>/` until librarian archival. Evidence: `tests/repo-structure.test.mjs` asserted no `work/<day>` directory could exist while `lib/personas/compliance-auditor.md` requires `/work/<day>/<id>/compliance-audit.md` and `/work/<day>/<id>/compliance-remediation.md`.

### note

- Dependency-backed lint, build, typecheck, publint, and are-the-types-wrong were not executed because the uploaded zip did not include `node_modules` and the container could not download pnpm packages. Direct Node tests and scripts that do not require installed dependencies were executed.

## Auto-remediations applied

- Removed the legacy two-level policy-compliance regex branch from `.cursor/hooks/enforce-policy-compliance.sh`; risk is low because the repository had already standardized on the three-level work shape and an existing backlog item requested this exact removal.
- Replaced live two-level work placeholders with `work/<day>/<id>/`, `work/<day>/<task-id>/`, or `work/*/*/run.log.jsonl` as appropriate; risk is low because this is reference alignment with the existing timestamp-naming convention.
- Narrowed `.cursor/rules/coder.mdc` from broad `lib/**/*` activation to implementation package, test, tool, and explicit touch-set paths; risk is medium because Cursor rule activation changes can affect invocation ergonomics.
- Added `.cursor/agents/**`, `.cursor/hooks/**`, and `.cursor/rules/**` to the Phase 0a workflow path filters; risk is low because the workflow already covers adjacent governance surfaces.
- Updated `tests/repo-structure.test.mjs` to allow active work day directories when their days-to-FDS prefix is correct, and added regression coverage for three-level placeholders, policy hook shape, and broad Cursor rule globs; risk is low.
- Updated `lib/memory/handbook/context-cost-audit.md` to record the broad-rule cost control and current root-tests layout; risk is low.
- Marked the existing `policy-compliance-hook-legacy-shape-removal` backlog item as `done`; risk is low because the hook removal and regression test land in the same patch.

## Documentation-impact decision

Documentation impact applies.

Updated documentation and reference surfaces:

- `docs/PRD.md`
- `lib/memory/handbook/glossary.md`
- `lib/memory/handbook/context-cost-audit.md`
- `lib/memory/features/timestamp-naming-conventions/spec.md`
- `lib/memory/features/timestamp-naming-conventions/delivery-report.md`
- `lib/memory/features/cursor-token-economy/spec.md`
- `lib/memory/features/active-memory-context-economy-pass-2/spec.md`
- `lib/memory/backlog/index.yaml`

No new deferred documentation item is required. Existing broad citation-hash and citation-range refresh work remains tracked by `bootstrap-content-hash-refresh` and `citation-range-realignment-pass` in `lib/memory/backlog/index.yaml`.

## Proposal decisions

No new policy or structure proposal is emitted. This audit applied deterministic remediations for already-ratified conventions and closed one existing backlog item.

## Gate recommendation

`compliance_passes: true`.

Predicate summary: the audited structural convention issues were remediated, regression tests now cover the fixed controls, and all direct Node validation gates available in the container pass.
