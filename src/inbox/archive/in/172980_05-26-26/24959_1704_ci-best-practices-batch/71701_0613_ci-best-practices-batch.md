---
title: CI and best-practices batch — test aggregation, compliance runner, citation refresh, MCP read tools
feature_id: ci-best-practices-batch
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:13:00Z
references:
  - kind: path
    path: package.json
    note: No top-level test script; CI does not run turbo run test.
  - kind: path
    path: tests/compliance/
    note: Five descriptors; operator-on-demand only today.
  - kind: path
    path: src/memory/features/timestamp-naming-conventions/citation-rot-scan.md
    note: Documents 501 TBD-on-commit contentHash placeholders.
  - kind: path
    path: src/internal/packages/@daedaline/mcp-server/
    note: Four of twelve MCP tools wired; eight return stub envelopes.
  - kind: path
    path: src/internal/work_archive/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md
    note: Finding n-01 (missing pnpm test) and m-02 (bulk contentHash debt).
  - kind: path
    path: src/internal/tools/canonical-json-format.mjs
    note: Hash abbreviation utilities for citation refresh.
  - kind: path
    path: src/internal/packages/@daedaline/cli/src/run.test.ts
    note: Package vitests exist but are not exercised in CI.
---

# CI and best-practices batch — test aggregation, compliance runner, citation refresh, MCP read tools

This intake consolidates four related quality-ratchet items into one delivery
batch. Each work package retains its original `feature_id` for tracking and
downstream feature-folder creation.

| Work package | Original `feature_id` |
|---|---|
| `pnpm test` aggregator + CI | `ci-test-aggregation` |
| Compliance descriptor runner | `compliance-descriptor-runner` |
| Bulk contentHash refresh tool | `bulk-contenthash-refresh` |
| MCP read-only tool wire-up | `mcp-server-readonly-tool-wireup` |

## Problem

Four gaps weaken the bootstrap quality ratchet: tests that never run in CI,
compliance descriptors that never execute automatically, citation debt that
blocks clean audits, and an MCP surface that looks mostly stubbed to external
clients.

1. **Test aggregation.** The repo ships 32+ vitest specs and several
   `node --test` suites, but CI never runs `turbo run test` and there is no
   top-level `pnpm test`. Operators invoke named scripts individually;
   package regressions slip through.

2. **Compliance automation.** `tests/compliance/*.yaml` defines five
   descriptors, but there is no runner, no CI gate, and no exit-code contract.
   Broad-sweep audits fall back to ad-hoc shell sequences.

3. **Citation placeholders.** ~501 `TBD-on-commit` `contentHash` values sit
   across ADRs, feature specs, and handbook anchors. Hand-fixing is
   impractical; compliance-auditor records `m-02` on every broad sweep.

4. **MCP read tools.** `@daedaline/mcp-server` wires four tools; eight return
   `{"status":"stub"}`. The four highest-value read-only tools
   (`feature.list`, `feature.show`, `status`, `memory.query`) need only
   handler wiring over existing primitives.

## Goal

Ship one coordinated batch that tightens CI, automates compliance descriptors,
clears documented citation placeholder debt, and wires the read-only MCP
tools—without expanding write surfaces or adding net-new product scope.

## Required outcomes

### Work package A — `ci-test-aggregation`

1. `package.json` adds a `"test"` script running `turbo run test` plus
   existing node-test suites (`repo-structure`, `migrate-json-formatting`,
   migration, context-budget).
2. Each `@daedaline/*` package declares a `test` script so `turbo run test`
   executes existing vitest configs.
3. CI runs `pnpm test` after `lint`, `typecheck`, `attw`, and `publint`.
4. Integration smoke tests needing external services run in a separate
   optional CI job.
5. The compliance-auditor persona tool grant reconciles with the real
   `pnpm test` shape.

### Work package B — `compliance-descriptor-runner`

1. `node src/internal/tools/run-compliance.mjs [<descriptor>]` runs one or
   all descriptors under `tests/compliance/*.yaml` and exits non-zero on any
   `severity: block` finding.
2. The runner validates descriptors against
   `tests/compliance/schemas/latest.yaml` before executing assertions.
3. Pluggable assertion adapters cover existing check kinds without coupling
   the runner to a single assertion shape.
4. CI runs the full descriptor surface on every PR after `pnpm test`.
5. With `--run-id`, the runner emits a JSON result under
   `src/work/<day>/<task-id>/` for dual-anchor audit evidence.

### Work package C — `bulk-contenthash-refresh`

1. `node src/internal/tools/refresh-citations.mjs [--dry-run] [<glob>...]`
   patches `contentHash` placeholders and stale hashes in place.
2. The tool reuses `canonical-json-format.mjs` for abbreviated hashes per the
   `json-formatting` spec.
3. The tool handles Markdown fenced JSON, `*.json` bodies, and YAML
   frontmatter `references:` lists.
4. The tool is idempotent and refuses `src/inbox/notes/`; it respects
   semantic immutability for `src/inbox/{in,out,threads}/`.
5. A node-test suite under `tests/` covers all three citation surfaces.

### Work package D — `mcp-server-readonly-tool-wireup`

1. `ddl.feature.list`, `ddl.feature.show`, `ddl.status`, and
   `ddl.memory.query` return typed results (not stub envelopes).
2. Results share a common envelope and propagate dual-anchor citation
   metadata where applicable.
3. A vitest suite exercises all four tools through the stdio MCP transport.
4. `@daedaline/mcp-server` README documents the wired surface and Q18
   curated-then-expansion plan.
5. Remaining write tools stay stubbed with the structured deferral protocol
   when that protocol ships (may depend on operator-tooling batch).

## Acceptance criteria

- `pnpm install && pnpm test` runs every spec; CI fails clearly on regression.
- `node src/internal/tools/run-compliance.mjs` runs all five descriptors
  green; new YAML descriptors are picked up without runner code changes.
- `refresh-citations.mjs --write` resolves the documented placeholder debt;
  the next compliance broad sweep closes `m-02`.
- MCP clients can call the four read-only tools without `{"status":"stub"}`.
- One delivery report records CI wallclock impact (target ≤ 3 minutes added
  for the test job) and lists touch-set paths for all four packages.
- Work packages land in dependency order: **A → B → C → D** (CI must run
  tests before compliance gate; citation refresh is a large deterministic
  diff best validated after tests are green; MCP handlers benefit from
  stable test harness).

## Out of scope

- New tests beyond what already exists (except harness tests for new tools).
- Coverage gating (M2 threshold-policy work).
- `ddl compliance run` CLI verb (node script is sufficient until M2).
- LLM-judge descriptor execution (M2 per PRD §4.5).
- Resolving `gone` citations whose target files no longer exist.
- MCP write tools, HTTP transport, or MCP elicitations.

## Recommended downstream owners

| Work package | Primary owners |
|---|---|
| A — CI test aggregation | `daedaline-engineer` (aggregator + package scripts); `coder` (workflow); `reviewer` (runtime budget) |
| B — Compliance runner | `daedaline-engineer` (runner + CI); `compliance-auditor` (adapter contract); `reviewer` (exit codes) |
| C — Citation refresh | `daedaline-engineer` (tool + tests); `librarian` (post-merge sweep); `compliance-auditor` (m-02 closure) |
| D — MCP read tools | `tech-lead` (result envelope); `daedaline-engineer` (handlers + vitest); `reviewer` (no-write audit) |
| Batch integration | `supervisor` (sequencing); `tech-writer` (handbook/contract-format doc for refresh tool) |
