---
title: CI and best-practices batch — test aggregation, compliance runner, citation refresh, MCP read tools
feature_id: ci-best-practices-batch
status: human-ratified
next_owner: tech-lead
next_stage: plan
source_inbox_item: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
intake_round: 0
work_packages:
  - feature_id: ci-test-aggregation
    label: WP-A — pnpm test aggregator and CI gate
  - feature_id: compliance-descriptor-runner
    label: WP-B — Compliance descriptor runner
  - feature_id: bulk-contenthash-refresh
    label: WP-C — Bulk contentHash refresh tool
  - feature_id: mcp-server-readonly-tool-wireup
    label: WP-D — MCP read-only tool wire-up
references:
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [1, 43]
    contentHash: 41e9308
    note: Directive frontmatter and work-package table define the four quality-ratchet items consolidated in this batch.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [45, 68]
    contentHash: 41e9308
    note: Problem section enumerates the four gaps — no pnpm test, no compliance runner, 501 contentHash placeholders, eight stubbed MCP tools.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [78, 89]
    contentHash: 41e9308
    note: WP-A required outcomes — pnpm test script, turbo run test wiring, CI step ordering, optional integration job, compliance-auditor persona reconciliation.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [91, 102]
    contentHash: 41e9308
    note: WP-B required outcomes — run-compliance.mjs CLI, schema validation, pluggable adapters, CI gate after pnpm test, --run-id JSON emission.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [104, 115]
    contentHash: 41e9308
    note: WP-C required outcomes — refresh-citations.mjs CLI, canonical-json-format.mjs reuse, three citation surface types, idempotency and inbox-notes refusal, node-test suite.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [117, 126]
    contentHash: 41e9308
    note: WP-D required outcomes — four read-only MCP tool handlers, common envelope, vitest stdio transport suite, README documentation, write tools remain deferred.
  - kind: lines
    path: src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md
    range: [128, 161]
    contentHash: 41e9308
    note: Acceptance criteria and out-of-scope section; includes delivery-order constraint A→B→C→D and CI wallclock target of at most 3 minutes added.
  - kind: lines
    path: package.json
    range: [1, 20]
    contentHash: ef10f9f
    note: Root package.json carries no top-level test script; WP-A adds the missing "test" entry running turbo run test plus named node-test suites.
  - kind: lines
    path: src/internal/packages/@daedaline/cli/src/run.ts
    range: [1, 50]
    contentHash: f78e151
    note: run.ts contains the stub() helper and deferred-verb exits that WP-A CI smoke tests must exercise.
  - kind: lines
    path: src/internal/packages/@daedaline/cli/src/run.test.ts
    range: [1, 30]
    contentHash: efb65fa
    note: Package vitest suite exists but is not exercised by CI today; WP-A wires turbo run test so these specs run on every PR.
  - kind: lines
    path: src/memory/features/timestamp-naming-conventions/citation-rot-scan.md
    range: [1, 20]
    contentHash: d8c670e
    note: Documents 501 TBD-on-commit contentHash placeholders; WP-C refresh-citations.mjs targets this documented debt; WP-B compliance runner closes finding m-02 after the refresh.
  - kind: lines
    path: src/internal/tools/canonical-json-format.mjs
    range: [1, 30]
    contentHash: 5c12707
    note: Hash abbreviation utilities that WP-C must reuse for abbreviated contentHash computation across Markdown, JSON, and YAML surfaces.
  - kind: lines
    path: tests/compliance/schemas/latest.yaml
    range: [1, 20]
    contentHash: 43bdbf6
    note: Schema against which WP-B validates each descriptor before executing assertions; changes to this schema are in-scope for WP-B adapter conformance.
---

# Spec

This Feature SHALL deliver four coordinated quality-ratchet improvements to the
Daedaline bootstrap. Each improvement corresponds to a named work package (WP)
that retains its original `feature_id` for downstream tracking and feature-folder
creation.

**WP-A (`ci-test-aggregation`)** SHALL add a top-level `pnpm test` script to
`package.json` that aggregates `turbo run test` plus all existing named
`node --test` suites, and SHALL wire that script into CI so every PR exercises
the full test surface.

**WP-B (`compliance-descriptor-runner`)** SHALL deliver
`node src/internal/tools/run-compliance.mjs` as an executable node script that
runs all five descriptors under `tests/compliance/*.yaml`, validates each
against `tests/compliance/schemas/latest.yaml`, and exits non-zero on any
`severity: block` finding. CI SHALL invoke the runner after `pnpm test` on
every PR.

**WP-C (`bulk-contenthash-refresh`)** SHALL deliver
`node src/internal/tools/refresh-citations.mjs` as an idempotent tool that
patches `contentHash` placeholders and stale hashes across Markdown fenced JSON,
`*.json` bodies, and YAML frontmatter `references:` lists, resolving the 501
documented `TBD-on-commit` placeholders.

**WP-D (`mcp-server-readonly-tool-wireup`)** SHALL wire the four highest-value
read-only MCP tools — `ddl.feature.list`, `ddl.feature.show`, `ddl.status`,
and `ddl.memory.query` — so they return typed results rather than
`{"status":"stub"}` envelopes.

Work packages MUST land in delivery order **A → B → C → D**: CI must run tests
before the compliance gate is added; citation refresh is a large deterministic
diff best validated after tests are green; MCP handlers benefit from a stable
test harness.

## Acceptance criteria

### WP-A — CI test aggregation

- The `package.json` root SHALL carry a `"test"` script that runs
  `turbo run test` and the four named `node --test` suites (`repo-structure`,
  `migrate-json-formatting`, `migration`, `context-budget`) in a single
  invocation.
- When `turbo run test` executes, each `@daedaline/*` package SHALL resolve a
  `test` script entry that invokes its existing vitest config.
- The CI workflow SHALL execute `pnpm test` as a named step after `lint`,
  `typecheck`, `attw`, and `publint` succeed.
- When a test suite requires an external service, the CI workflow SHALL place
  that suite in a separate optional job that does not block the required
  `pnpm test` step.
- The `compliance-auditor` persona's tool-grant block SHALL reference `pnpm test`
  as the canonical test-run command after WP-A merges.

### WP-B — Compliance descriptor runner

- When an operator invokes
  `node src/internal/tools/run-compliance.mjs [<descriptor>]`, the runner SHALL
  execute one named descriptor or all descriptors under `tests/compliance/*.yaml`
  and SHALL exit non-zero when any `severity: block` finding is present.
- Before executing assertions, the runner SHALL validate each descriptor against
  `tests/compliance/schemas/latest.yaml` and SHALL exit non-zero with a
  descriptive message when validation fails.
- The runner SHALL expose a pluggable adapter interface so each existing check
  kind is handled without coupling the runner to a single assertion shape.
- When the CI workflow executes the compliance step, it SHALL invoke the full
  descriptor surface via `node src/internal/tools/run-compliance.mjs` after
  `pnpm test` succeeds, and SHALL fail the PR when the runner exits non-zero.
- When an operator supplies `--run-id <id>`, the runner SHALL emit a JSON result
  file at `src/work/<day>/<run-id>/compliance-result.json` for dual-anchor audit
  evidence.
- When a new `*.yaml` descriptor is added under `tests/compliance/`, the runner
  SHALL pick it up without runner code changes.

### WP-C — Bulk contentHash refresh tool

- When an operator invokes
  `node src/internal/tools/refresh-citations.mjs [--dry-run] [<glob>...]`,
  the tool SHALL locate `contentHash` fields whose value is `TBD-on-commit` or
  whose abbreviated hash does not match the current file content, and SHALL patch
  them in place.
- The tool SHALL compute abbreviated hashes using the utilities in
  `src/internal/tools/canonical-json-format.mjs`, producing 7-character SHA
  prefixes consistent with the `json-formatting` spec.
- The tool SHALL handle three citation surfaces: Markdown fenced JSON blocks,
  standalone `*.json` bodies, and YAML frontmatter `references:` lists.
- The tool SHALL be idempotent: when run twice on the same inputs, the second
  invocation SHALL produce no diff.
- The tool SHALL refuse to write any path under `src/inbox/notes/` and SHALL
  treat `src/inbox/{in,out,threads}/` as semantically immutable, skipping those
  paths with a logged warning.
- When run with `--dry-run`, the tool SHALL emit the proposed patch diff to
  stdout without writing any file.
- A `node --test` suite under `tests/` SHALL cover all three citation surfaces,
  the idempotency invariant, and the `src/inbox/notes/` refusal.
- After `refresh-citations.mjs --write` applies, the next compliance broad sweep
  SHALL report finding `m-02` as resolved.

### WP-D — MCP read-only tool wire-up

- When an MCP client calls `ddl.feature.list`, the handler SHALL return a typed
  array of feature summaries derived from `src/memory/features/*/index.json`
  entries, not a `{"status":"stub"}` envelope.
- When an MCP client calls `ddl.feature.show` with a `feature_id` argument, the
  handler SHALL return the typed spec and index data for that feature, or a
  structured not-found error when the feature does not exist.
- When an MCP client calls `ddl.status`, the handler SHALL return a typed
  pipeline-status summary derived from active work state and `daedaline.yaml`.
- When an MCP client calls `ddl.memory.query` with a `query` argument, the
  handler SHALL return typed memory entries matching the query from the active
  and handbook memory tiers.
- All four handlers SHALL return responses conforming to a shared typed envelope
  that propagates dual-anchor citation metadata where applicable.
- A vitest suite SHALL exercise all four tools through the stdio MCP transport
  and SHALL assert that no handler returns `{"status":"stub"}`.
- The `@daedaline/mcp-server` README SHALL document the wired read surface and
  SHALL identify the eight remaining write tools as deferred with their milestone
  tracking pointers.
- Remaining write MCP tools SHALL remain stubbed using the structured deferral
  protocol per `src/internal/packages/@daedaline/cli/src/run.ts` when that
  protocol ships; until then, they MAY retain the existing stub envelope.

### Cross-cutting

- One delivery report SHALL record CI wallclock impact; the added test job
  SHALL contribute at most 3 minutes of additional wall time to the PR workflow.
- The delivery report SHALL list touch-set paths for all four work packages.

## Out of scope

- Writing new tests beyond what already exists in the repo, except harness tests
  for the three new tools (`run-compliance.mjs`, `refresh-citations.mjs`, and
  the MCP vitest suite).
- Coverage gating; threshold-policy work is deferred to M2.
- A `ddl compliance run` CLI verb; the node script is sufficient until M2.
- LLM-judge descriptor execution; that is deferred to M2 per PRD §4.5.
- Resolving `gone` citations whose target files no longer exist in the working
  tree; `refresh-citations.mjs` SHALL skip absent paths with a logged warning.
- MCP write tools, HTTP transport, or MCP elicitation support.
- Inbox archival for any file touched by WP-C; semantic immutability per
  `src/memory/handbook/inbox-lifecycle.md` §3b prohibits mutation of
  `src/inbox/{in,out,threads}/`.

## Downstream owners

The following persona assignments are RECOMMENDED for the plan stage:

| Work package | Recommended owner(s) |
|---|---|
| WP-A — `pnpm test` script and package `test` entries | `daedaline-engineer` (aggregator, package scripts); `coder` (CI workflow); `reviewer` (runtime budget) |
| WP-B — Compliance runner and CI gate | `daedaline-engineer` (runner, CI); `compliance-auditor` (adapter contract, finding m-02 closure); `reviewer` (exit-code audit) |
| WP-C — Citation refresh tool | `daedaline-engineer` (tool, node-test suite); `librarian` (post-merge sweep); `compliance-auditor` (m-02 closure verification) |
| WP-D — MCP read handlers | `tech-lead` (shared result envelope design); `daedaline-engineer` (handlers, vitest suite); `reviewer` (no-write audit) |
| Batch integration and sequencing | `supervisor` (A→B→C→D ordering); `tech-writer` (handbook and contract-format docs for refresh tool) |

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
