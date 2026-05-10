# Compliance Audit Report

## 1) Scope contract

- Trigger: broad sweep (`/compliance-auditor` invoked without `run_log` selector).
- Effective interaction mode:

```yaml
audit_interaction:
  mode: "non_interactive"
```

- Run-log selector: none.
- Path set audited:
  - Full working tree policy scan for unresolved citation hashes (`contentHash: TBD-on-commit`).
  - Governance surfaces: `AGENTS.md`, `memory/handbook/constitution.md`, `memory/handbook/documentation-impact-contract.md`, `memory/handbook/policy-compliance-contract.md`.
  - Gate wiring: `.cursor/hooks.json`, `.cursor/hooks/enforce-policy-compliance.sh`.
  - Persona and contract drift sampling across `personas/**`, `.cursor/agents/**`, and `memory/features/**/contracts/**`.
  - Existing and current compliance artifacts under `work/**`.

## 2) Checks executed

- `git-status-cleanliness`: `git status --short` and `git diff --name-only`.
- `placeholder-hash-scan`: repository-wide scan for `contentHash: TBD-on-commit`.
- `placeholder-hash-count`: full-tree Python count of unresolved placeholders (92 files, 309 placeholders).
- `governance-alignment-read`: direct inspection of AGENTS working agreement and constitution/documentation-impact/policy-compliance contracts.
- `policy-gate-hook-presence`: verified `.cursor/hooks.json` matcher and `.cursor/hooks/enforce-policy-compliance.sh` implementation.
- `policy-artifact-readiness`: generated and validated `internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/policy-compliance.json` for this invocation because non-`work/` policy files were remediated.

## 3) Findings

### block

- None.

### major

- `MAJOR-001` Residual dual-anchor integrity drift remains repo-wide: unresolved `contentHash: TBD-on-commit` placeholders persist in governance-adjacent persona mirrors and feature contracts after this pass, so not all citations are immutable.
  - Evidence anchors:
    - `{kind: lines, path: "AGENTS.md", range: [89, 104], contentHash: "3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14"}`
    - `{kind: lines, path: "personas/compliance-auditor.md", range: [73, 76], contentHash: "5d1d1b136b57b1a50d84ceebb9811cdf95d8776113f2dacf908ca7271a9ccc55"}`
    - `{kind: lines, path: "memory/features/tesseract-core/contracts/tesseract.core.package_shape.yaml", range: [14, 19], contentHash: "9ff1eaf25a45b6bbd0fc14d2d4b70a9d50b88d6b1a0bc44871724a4cc0be4db2"}`
  - Unresolved owner route: `contract-writer` (policy corpus normalization) with `librarian` support (index/reference sweep).

### minor

- None.

### note

- `NOTE-001` AGENTS working-agreement obligations and constitution policy text are aligned on documentation-impact discipline and governed-commit policy-compliance gating.
  - Evidence anchors:
    - `{kind: lines, path: "AGENTS.md", range: [96, 104], contentHash: "3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14"}`
    - `{kind: lines, path: "memory/handbook/constitution.md", range: [108, 116], contentHash: "00874481f8aaaa6618a4b6ab4d3d115ebfffd5dcf61d3d2ef38bb2076ed17432"}`
    - `{kind: lines, path: "memory/handbook/documentation-impact-contract.md", range: [49, 79], contentHash: "38ed8213e11f7aa1f53d46588cc55cad7da746016c52aa1747f03d8b97d16248"}`
    - `{kind: lines, path: "memory/handbook/policy-compliance-contract.md", range: [49, 55], contentHash: "6a7a1e5d27a3c1c0dec59b19c5267e817ea03dcef969b2eba3d6c11cc42a228a"}`

- `NOTE-002` Commit-time gate coherence is active: `git commit` is fail-closed via hook matcher and artifact validation logic.
  - Evidence anchors:
    - `{kind: lines, path: ".cursor/hooks.json", range: [4, 9], contentHash: "04532edfca708a6317d49bb97462cf121d1ca2f474b4f4b2649b16cfdba29e6e"}`
    - `{kind: lines, path: ".cursor/hooks/enforce-policy-compliance.sh", range: [79, 84], contentHash: "d7818ff7ac6573710b90c99d35d8414652ff2cb0353ad3297f9cebf2bfeb59c0"}`

- `NOTE-003` Non-`work/` structural remediations in this invocation now have a staged policy artifact with required source checks and documentation-impact linkage.
  - Evidence anchors:
    - `{kind: lines, path: "memory/handbook/policy-compliance-contract.md", range: [49, 58], contentHash: "6a7a1e5d27a3c1c0dec59b19c5267e817ea03dcef969b2eba3d6c11cc42a228a"}`
    - `{kind: lines, path: "internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/policy-compliance.json", range: [1, 33], contentHash: "1e7f214d702ec23309cbf4f4991bcc5f585736db55cbc1640ea85e68d9c05d16"}`

## 4) Auto-remediations applied

- Replaced unresolved `contentHash: TBD-on-commit` placeholders with concrete SHA-256 hashes in `memory/handbook/documentation-impact-contract.md`; rationale: restore immutable dual-anchor evidence in a governing handbook contract; changed paths: `memory/handbook/documentation-impact-contract.md`; risk note: low risk, metadata-only update.
- Replaced unresolved `contentHash: TBD-on-commit` placeholders with concrete SHA-256 hashes in `memory/handbook/constitution.md`; rationale: align constitutional references with dual-anchor immutability requirements; changed paths: `memory/handbook/constitution.md`; risk note: low risk, metadata-only update.
- Replaced unresolved `contentHash: TBD-on-commit` placeholders with concrete SHA-256 hashes in `memory/handbook/policy-compliance-contract.md`; rationale: harden policy gate source citations used by commit-time controls; changed paths: `memory/handbook/policy-compliance-contract.md`; risk note: low risk, metadata-only update.
- Added invocation-local policy artifact `internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/policy-compliance.json`; rationale: preserve gate readiness for non-`work/` policy file remediations during this audit; changed paths: `internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/policy-compliance.json`; risk note: low risk, additive artifact under `work/`.

## 5) Documentation-impact decision

Pass. The required post-task decision was evaluated and recorded.

```yaml
documentation_impact:
  applies: true
  rationale: "Governance handbook policy surfaces were updated and new compliance artifacts were emitted."
  changed-surfaces:
    - memory/handbook/documentation-impact-contract.md
    - memory/handbook/constitution.md
    - memory/handbook/policy-compliance-contract.md
    - internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/compliance-audit.md
    - internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/compliance-remediation.md
  deferred-items: []
```

## 6) Proposal decisions

- `proposal_id`: `normalize-dual-anchor-contenthash-corpus`
  - `status`: `deferred`
  - `problem_statement`: Repo-wide unresolved `contentHash: TBD-on-commit` placeholders create recurring citation-integrity drift across personas, skills, ADRs, and feature contracts.
  - `evidence_anchors`:
    - `{kind: lines, path: "AGENTS.md", range: [89, 91], contentHash: "3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14"}`
    - `{kind: lines, path: "personas/compliance-auditor.md", range: [73, 76], contentHash: "5d1d1b136b57b1a50d84ceebb9811cdf95d8776113f2dacf908ca7271a9ccc55"}`
    - `{kind: lines, path: "memory/features/tesseract-core/contracts/tesseract.core.package_shape.yaml", range: [14, 19], contentHash: "9ff1eaf25a45b6bbd0fc14d2d4b70a9d50b88d6b1a0bc44871724a4cc0be4db2"}`
  - `proposed_change`: Run a controlled repository-wide content-hash normalization pass for `references[]` and contract wrappers, then lint for zero remaining placeholders.
  - `expected_impact`: Reduce citation-lint risk and policy review ambiguity by eliminating placeholder anchors from canonical surfaces.
  - `risk_note`: A broad metadata rewrite can produce large diffs and may require staged rollout by domain.
  - `owner_recommendation`: `contract-writer` with `librarian` coordination.
  - `backlog_routing_result`: No backlog item created in non-interactive mode without explicit human request.
  - `contract_clause`:

```yaml
id: tesseract.governance.normalize-dual-anchor-contenthash-corpus
kind: rego
severity: block
applies_to:
  kind: file-path
  glob: "{AGENTS.md,memory/handbook/**/*.md,personas/**/*.md,.cursor/agents/**/*.md,memory/features/**/contracts/**/*.{yaml,yml,md}}"
owner: contract-writer
description: |
  When a governance document or contract artifact carries a `references[]` anchor, the contract-runner SHALL report a block-level failure unless every `contentHash` value is a concrete lowercase SHA-256 digest and no `contentHash` equals `TBD-on-commit`.
references:
  - kind: lines
    path: AGENTS.md
    range: [89, 104]
    contentHash: 3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14
    note: "Working-agreement requirement for dual-anchor citations and policy discipline."
  - kind: lines
    path: memory/handbook/constitution.md
    range: [108, 116]
    contentHash: 00874481f8aaaa6618a4b6ab4d3d115ebfffd5dcf61d3d2ef38bb2076ed17432
    note: "Constitutional governance obligations for machine-checkable policy controls."
  - kind: lines
    path: memory/handbook/policy-compliance-contract.md
    range: [49, 55]
    contentHash: 6a7a1e5d27a3c1c0dec59b19c5267e817ea03dcef969b2eba3d6c11cc42a228a
    note: "Governed-commit policy artifact gate expectations."
spec: /internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/normalize-dual-anchor-contenthash-corpus.rego
runtime:
  package: tesseract.governance.dual_anchor_contenthash
  query: data.tesseract.governance.dual_anchor_contenthash.deny
metadata:
  tesseract.contract_id: tesseract.governance.normalize-dual-anchor-contenthash-corpus
  tesseract.applies_to: file-path:{AGENTS.md,memory/handbook/**/*.md,personas/**/*.md,.cursor/agents/**/*.md,memory/features/**/contracts/**/*.{yaml,yml,md}}
```

## 7) Gate recommendation

`compliance_passes: false`

Predicate summary: localized governance fixes succeeded, but unresolved major citation-integrity drift remains repo-wide and requires follow-up ownership.

## 8) Deferred decisions

- Deferred decision: `normalize-dual-anchor-contenthash-corpus`.
  - Owner routing: `contract-writer` (primary), `librarian` (secondary).
  - Rerun trigger: after owner-scoped corpus normalization PR is staged, rerun `/compliance-auditor` broad sweep in `non_interactive` mode.

## 9) Contract execution result (2026-04-26)

- `contract_id`: `tesseract.governance.normalize-dual-anchor-contenthash-corpus`
- `execution_owner`: `tesseract-engineer`
- `status`: `partial-fail` (blocked by protected persona constraints)
- `execution_summary`:
  - Executed a repository-scope normalization pass across the clause `applies_to` set and replaced `references[].contentHash: TBD-on-commit` with concrete lowercase SHA-256 digests where deterministic line anchors were available.
  - Applied 205 reference-hash replacements across 76 files in scope (`memory/handbook/**`, `personas/**` except protected files, `.cursor/agents/**`, and `memory/features/**/contracts/**`).
  - Residual violations are limited to 5 placeholders in protected files that this invocation MUST NOT modify: `personas/contract-writer.md` and `personas/persona-designer.md`.
- `evidence_anchors`:
  - `{kind: lines, path: "personas/contract-writer.md", range: [55, 65], contentHash: "TBD-on-commit"}`
  - `{kind: lines, path: "personas/persona-designer.md", range: [49, 54], contentHash: "TBD-on-commit"}`
  - `{kind: lines, path: "internal/work_archive/173010_04-26-26/22246_1749_compliance-audit-broad-2026-04-26-1340/normalize-dual-anchor-contenthash-corpus.rego", range: [34, 40], contentHash: "d0176e487d76f4159a7e6e93ffcd097de91ea53ec57ff4f29e6b8c46ece579c7"}`
- `owner_routing`:
  - Primary: `contract-writer` (self-protected persona content update ratification).
  - Secondary: `persona-designer` (authorized update pathway for protected persona references).
- `rerun_trigger`:
  - After ratified updates to the 5 protected placeholders are staged, rerun this clause (`tesseract.governance.normalize-dual-anchor-contenthash-corpus`) and verify zero `references[].contentHash: TBD-on-commit` in clause scope.
