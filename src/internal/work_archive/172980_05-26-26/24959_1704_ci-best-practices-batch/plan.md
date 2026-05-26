---
title: Plan - ci-best-practices-batch
task_id: 24959_1704_ci-best-practices-batch
feature_id: ci-best-practices-batch
stage: plan
status: proposed
owner: tech-lead
updated_at: 2026-05-26
references:
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [88, 120]
    contentHash: 22be0fb
    note: Batch scope and mandated delivery order A -> B -> C -> D.
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [123, 138]
    contentHash: 22be0fb
    note: WP-A acceptance criteria for pnpm test aggregation and CI wiring.
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [139, 158]
    contentHash: 22be0fb
    note: WP-B acceptance criteria for run-compliance.mjs and CI gate behavior.
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [159, 182]
    contentHash: 22be0fb
    note: WP-C acceptance criteria for refresh-citations.mjs and idempotency.
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [183, 205]
    contentHash: 22be0fb
    note: WP-D acceptance criteria for typed read-only MCP handlers.
  - kind: lines
    path: src/memory/features/ci-best-practices-batch/spec.md
    range: [207, 226]
    contentHash: 22be0fb
    note: Cross-cutting CI budget target and out-of-scope constraints.
  - kind: lines
    path: src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/state.json
    range: [13, 19]
    contentHash: 3969501
    note: Canonical run directory and artifact roots for this plan invocation.
---

# Architecture summary

This implementation SHALL land as four sequenced work packages to preserve gate
integrity and minimize regression risk: first standardize repository test
aggregation and CI invocation, then add a descriptor-driven compliance runner,
then refresh citation hashes with an idempotent deterministic tool, and finally
replace deferred MCP read-tool stubs with typed handlers that reuse the now
stable validation surface. The implement stage SHALL preserve A -> B -> C -> D
ordering so later packages build on verified earlier guarantees.

# Implementation tasks

1. **WP-A - Add root test aggregation and CI invocation.**
   - When root scripts are updated, `package.json` SHALL expose `test` as one
     command that executes `turbo run test` plus the named node test suites for
     repository structure, migration formatting, migration behavior, and context
     budget.
   - When CI runs `.github/workflows/phase-0a-scaffold.yml`, the workflow SHALL
     add a distinct `pnpm test` step after `lint`, `typecheck`, `attw`, and
     `publint`.
   - When package scripts are normalized, each package participating in
     `turbo run test` SHOULD expose a deterministic `test` script entry.
   - Traceability citation: `{kind: lines, path:
     "src/memory/features/ci-best-practices-batch/spec.md", range: [123, 138],
     contentHash: "22be0fb"}`.

2. **WP-B - Implement descriptor-runner compliance gate.**
   - When `node src/internal/tools/run-compliance.mjs` is invoked, the tool
     SHALL load one descriptor argument or discover all `tests/compliance/*.yaml`
     descriptors.
   - Before executing findings logic, the runner SHALL validate each descriptor
     against `tests/compliance/schemas/latest.yaml`.
   - When CI executes compliance, the workflow SHALL run the compliance runner
     after `pnpm test` and SHALL fail on non-zero exit.
   - When `--run-id <id>` is provided, the runner SHALL emit
     `src/work/<day>/<id>/compliance-result.json`.
   - Traceability citation: `{kind: lines, path:
     "src/memory/features/ci-best-practices-batch/spec.md", range: [139, 158],
     contentHash: "22be0fb"}`.

3. **WP-C - Implement deterministic citation refresh tooling.**
   - When `node src/internal/tools/refresh-citations.mjs` runs, it SHALL patch
     stale or `TBD-on-commit` `contentHash` values across Markdown fenced JSON,
     JSON files, and YAML frontmatter references.
   - The tool SHALL reuse hash utilities from
     `src/internal/tools/canonical-json-format.mjs`.
   - The tool SHALL be idempotent, SHALL support `--dry-run`, and SHALL refuse
     writes under `src/inbox/notes/` while skipping
     `src/inbox/{in,out,threads}/` with warnings.
   - A dedicated node test suite SHALL cover the three surfaces plus refusal and
     idempotency behavior.
   - Traceability citation: `{kind: lines, path:
     "src/memory/features/ci-best-practices-batch/spec.md", range: [159, 182],
     contentHash: "22be0fb"}`.

4. **WP-D - Wire MCP read-only handlers to typed responses.**
   - When `tess.feature.list`, `tess.feature.show`, `tess.status`, and
     `tess.memory.query` are called through MCP transport, handlers SHALL return
     typed non-stub envelopes.
   - Shared envelope and tests SHALL assert no handler emits
     `{"status":"stub"}`.
   - `@tesseract/mcp-server` README SHALL document implemented read-only tools
     and remaining deferred write tools.
   - Traceability citation: `{kind: lines, path:
     "src/memory/features/ci-best-practices-batch/spec.md", range: [183, 205],
     contentHash: "22be0fb"}`.

5. **Cross-cutting validation and runtime budget control.**
   - The implement stage SHALL run, at minimum:
     `node --test tests/*.test.mjs`,
     `node src/internal/tools/check-phase-0a-scaffold.mjs`,
     `node src/internal/tools/context-budget-report.mjs`,
     `bash -n .cursor/hooks/enforce-policy-compliance.sh`.
   - Delivery evidence SHALL report CI wallclock impact and SHALL hold added PR
     wall time to at most 3 minutes.
   - Traceability citation: `{kind: lines, path:
     "src/memory/features/ci-best-practices-batch/spec.md", range: [207, 226],
     contentHash: "22be0fb"}`.

# Documentation impact evaluation

- **Applies:** true.
- **Rationale:** This feature changes CI execution behavior, adds two operator
  tools, and replaces MCP read stubs with typed behavior; these changes affect
  operator and agent-facing surfaces.
- **Required updates in scope:** `@tesseract/mcp-server/README.md` and
  downstream delivery-report documentation.
- **Deferred items:** none at plan stage; implementation stage SHALL capture any
  additional doc deltas if touched paths expand.
