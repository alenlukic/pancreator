# Delivery Report

## Summary
`ci-best-practices-batch` shipped four coordinated updates: root CI test aggregation, a descriptor-driven compliance runner, deterministic citation refresh tooling, and typed MCP read-only handlers. The reviewer cleared MF-01 and MF-02, and the implementation report records green validation across the required command set.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/implementation-report.md",
  "range": [12, 143],
  "contentHash": "6c5431b"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/review.md",
  "range": [1, 33],
  "contentHash": "98d9b2a"
}
```

## Architecture
- The batch preserves the A -> B -> C -> D delivery order so CI hardening lands before compliance gating, citation refresh, and MCP read activation.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/plan.md",
  "range": [47, 55],
  "contentHash": "5cb5270"
}
```

- The implementation treats the batch as one hard-gated touch-set and keeps the added PR wall time capped at 3 minutes.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/adr-draft.md",
  "range": [41, 54],
  "contentHash": "ec6767d"
}
```

- The read-only MCP surface becomes deterministic while write-side MCP tools stay deferred.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/adr-draft.md",
  "range": [61, 72],
  "contentHash": "ec6767d"
}
```

## Interfaces
- `package.json` now exposes `scripts.test` as a single root test entry that runs `turbo run test` plus the named node test suites.

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [1, 33],
  "contentHash": "31789e8"
}
```

- `.github/workflows/phase-0a-scaffold.yml` now runs `pnpm test` as a named CI step before the compliance-descriptor step.

```json
{
  "kind": "lines",
  "path": ".github/workflows/phase-0a-scaffold.yml",
  "range": [1, 103],
  "contentHash": "a3c9ecf"
}
```

- `src/internal/tools/run-compliance.mjs` exports descriptor validation, discovery, `--run-id` resolution, and the `runCompliance` CLI entry point.

```json
{
  "kind": "lines",
  "path": "src/internal/tools/run-compliance.mjs",
  "range": [1, 330],
  "contentHash": "42b2bac"
}
```

- `src/internal/tools/refresh-citations.mjs` exports citation classification, hash refresh, glob matching, and the `refreshCitations` CLI entry point.

```json
{
  "kind": "lines",
  "path": "src/internal/tools/refresh-citations.mjs",
  "range": [1, 371],
  "contentHash": "eefffc5"
}
```

- `src/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts` exports the typed read handlers for feature listing, feature detail, memory query, and workspace status.

```json
{
  "kind": "lines",
  "path": "src/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts",
  "range": [1, 302],
  "contentHash": "4ab9284"
}
```

- `src/internal/packages/@pancreator/mcp-server/src/definitions.ts` publishes the read-tool definitions and resource templates, and `src/internal/packages/@pancreator/mcp-server/src/pan-execute.ts` wires the shared deferral envelope plus the read-only tool router.

```json
{
  "kind": "lines",
  "path": "src/internal/packages/@pancreator/mcp-server/src/definitions.ts",
  "range": [1, 204],
  "contentHash": "42b89c1"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/packages/@pancreator/mcp-server/src/pan-execute.ts",
  "range": [1, 308],
  "contentHash": "927c649"
}
```

## Tradeoffs
- The reviewer accepted a broader touch-set because the batch needed a few extra traceability and fixture fixes to make the new gates stable, but the reviewer still noted that future batches should keep only materially changed paths to reduce noise.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/review.md",
  "range": [13, 15],
  "contentHash": "98d9b2a"
}
```

- The ADR accepted higher coordination cost across CI, tooling, tests, package scripts, and MCP modules because the ordered quality ratchet is deterministic and easier to validate end to end.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/adr-draft.md",
  "range": [61, 70],
  "contentHash": "ec6767d"
}
```

- Write-side MCP tools remain deferred, so the batch ships only the read surface and preserves the structured deferral path for later milestones.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/adr-draft.md",
  "range": [69, 72],
  "contentHash": "ec6767d"
}
```

## Usage guidelines
- Run `node src/internal/tools/run-compliance.mjs` to validate all compliance descriptors, or add `--run-id <task-id>` when you want the runner to emit `compliance-result.json` into the active work tree.

```json
{
  "kind": "lines",
  "path": "tests/run-compliance.test.mjs",
  "range": [45, 84],
  "contentHash": "2562228"
}
```

- Run `node src/internal/tools/refresh-citations.mjs --dry-run src/memory/**/*.md` when you want to preview citation updates without writing; omit `--dry-run` to apply them, and avoid `src/inbox/notes/` because the tool refuses that path.

```json
{
  "kind": "lines",
  "path": "tests/refresh-citations.test.mjs",
  "range": [27, 45],
  "contentHash": "877b08c"
}
```

```json
{
  "kind": "lines",
  "path": "tests/refresh-citations.test.mjs",
  "range": [91, 129],
  "contentHash": "877b08c"
}
```

- Use `pan.feature list`, `pan.feature show`, `pan.status`, and `pan.memory query` as read-only MCP calls when you need typed feature, workspace, or handbook answers instead of stub envelopes.

```json
{
  "kind": "lines",
  "path": "src/internal/packages/@pancreator/mcp-server/src/pan-execute.test.ts",
  "range": [78, 117],
  "contentHash": "c475848"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/packages/@pancreator/mcp-server/src/pan-execute.test.ts",
  "range": [120, 155],
  "contentHash": "c475848"
}
```

## Testing
The validation delta is command-level rather than numeric: the implementation report records passing `pnpm test`, `node src/internal/tools/run-compliance.mjs`, `node --test tests/*.test.mjs`, `pnpm --filter @pancreator/mcp-server test`, `node src/internal/tools/check-phase-0a-scaffold.mjs`, `node src/internal/tools/context-budget-report.mjs`, and `bash -n .cursor/hooks/enforce-policy-compliance.sh`. The review also notes that statement and branch coverage were not reported in the stage workspace, so there is no line-level coverage delta to quote yet.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/implementation-report.md",
  "range": [108, 124],
  "contentHash": "6c5431b"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/review.md",
  "range": [21, 33],
  "contentHash": "98d9b2a"
}
```

## Supersession (2026-05-28)

GitHub workflow files under `.github/workflows/` were removed after bootstrap. The
former `phase-0a-scaffold.yml` gate now lives in `OPERATION.md` § "Librarian
pre-close validation" and the qa-tester stage.
