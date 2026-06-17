# Quality, compliance, and governance

Use when changing compliance tests, JSON/timestamp policy, operator verification, CI expectations, contract style, or QA gates.

Read this category index before opening individual feature records. Prefer the compact rows below unless a task needs one specific feature record.

| Feature | Status | Planning context | Retained contracts | Path |
|---|---|---|---|---|
| `ci-best-practices-batch` | indexed | ci-best-practices-batch shipped four coordinated updates: root CI test aggregation, a descriptor-driven compliance runner, deterministic citation refresh tooling, and… | no | `lib/memory/features/quality-governance/ci-best-practices-batch/index.json` |
| `compliance-tests` | indexed | This slice ships the canonical compliance-test surface under tests/compliance/, the first-slice manual runbook, severity routing, run-template fields, and the AGENTS… | yes | `lib/memory/features/quality-governance/compliance-tests/index.json` |
| `json-formatting` | indexed | The json-formatting feature ships a canonical JSON formatting policy across all Round-02 R1 surfaces: repository .json artifacts, Markdown-embedded JSON, terminal/CLI… | no | `lib/memory/features/quality-governance/json-formatting/index.json` |
| `operator-verification-and-reopen` | indexed | Require an operator-facing verification pack at pipeline and ad-hoc close, gate archival on its presence, and provide pan reopen to unarchive closed tasks back to intake… | no | `lib/memory/features/quality-governance/operator-verification-and-reopen/index.json` |
| `timestamp-naming-conventions` | intake-closed | The Feature defines a UTC-only naming policy for in-scope temporal artifacts, migrates existing paths with a dry-run-first workflow, and rewrites references that name… | yes | `lib/memory/features/quality-governance/timestamp-naming-conventions/index.json` |
