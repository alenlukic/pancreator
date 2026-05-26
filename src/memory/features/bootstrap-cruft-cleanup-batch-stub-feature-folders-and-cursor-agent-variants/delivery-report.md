# Delivery report — bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants

- Task id: `54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`
- Feature id: `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`
- Stage: report
- Status: human-accepted

## Summary
Work package A normalized 20 `tesseract-*` feature folders by prepending YAML frontmatter to each `spec.md`, creating stub `delivery-report.md` and `index.json` files, and clearing global coverage gaps in `src/memory/features/index.json`. Work package B is corrected and reverted: the `-standard` and `-complex` mirrors remain in the tree, and the AGENTS, handbook, emit, and context-budget deletion pass is not part of the final diff. Canonical invocation stays suffix-aware: `/persona-standard` or `/persona` alias for default use, and `/persona-complex` for escalation.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [6, 35],
  "contentHash": "851d64e"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [21, 25],
  "contentHash": "26b1233"
}
```

## What shipped

### Work package A — `resolve-package-stub-feature-folders`
Twenty `tesseract-*` folders now carry the normalized stub shape: YAML frontmatter on `spec.md`, a stub `delivery-report.md`, a stub `index.json`, and a global `src/memory/features/index.json` pairing that clears `coverage_gaps` to `[]`. Contracts, plans, tasks, and contract wrappers stay untouched.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [8, 35],
  "contentHash": "851d64e"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [23, 24],
  "contentHash": "b9b306e"
}
```

### Work package B — `consolidate-cursor-agent-variants`
This package is corrected and reverted. The suffix mirrors were restored after operator review, so `.cursor/agents/*-standard.md` and `.cursor/agents/*-complex.md` remain present, and the AGENTS, handbook, emit, and context-budget tooling changes from the deletion pass are not in the final tree. The canonical invocation remains `/persona-standard` or `/persona` alias, with `/persona-complex` reserved for escalation.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [131, 152],
  "contentHash": "851d64e"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [46, 50],
  "contentHash": "94471db"
}
```

## Validation evidence

The reviewer marked the feature `pass` with `review_passes: true`, and all required validation commands passed.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [3, 5],
  "contentHash": "26b1233"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [60, 67],
  "contentHash": "26b1233"
}
```

The four validation commands were:

- `node --test tests/*.test.mjs` — pass.
- `node src/internal/tools/check-phase-0a-scaffold.mjs` — pass.
- `node src/internal/tools/context-budget-report.mjs` — pass.
- `bash -n .cursor/hooks/enforce-policy-compliance.sh` — pass.

## Known gaps / deferrals

`touch-set.json` still lists 45 Work package B-era paths with no current diff. That matches the corrected-and-reverted state, but refreshing touch-set scope would reduce future review ambiguity.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [15, 19],
  "contentHash": "26b1233"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [123, 129],
  "contentHash": "851d64e"
}
```

Optional librarian follow-up remains open for the `artifact_index.feature_folder.per_feature_index` shape. The current path-only form avoids a self-referential `contentHash` loop, and richer dual-anchor parity can wait for tooling that can stabilize self-citations.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [33, 35],
  "contentHash": "851d64e"
}
```

The `node --test tests/*.test.mjs` run also prints repeated `fatal: not a git repository` stderr noise from sandboxed test branches. The suite still passes, so the noise is non-blocking.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [17, 19],
  "contentHash": "26b1233"
}
```

## Operator acceptance criteria

- Verify the 20 `tesseract-*` folders each contain `spec.md` frontmatter, a stub `delivery-report.md`, and a stub `index.json`.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [23, 24],
  "contentHash": "b9b306e"
}
```

- Verify `src/memory/features/index.json` pairs each `tesseract-*` row with a per-feature `index.json` and clears `coverage_gaps` to `[]`.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [34, 35],
  "contentHash": "851d64e"
}
```

- Verify the suffix mirrors remain present and the canonical invocation still uses `/persona-standard` or `/persona`, with `/persona-complex` for escalation.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [48, 50],
  "contentHash": "94471db"
}
```

- Verify the validation commands remain green and no new must-fix finding appears during review.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [60, 67],
  "contentHash": "26b1233"
}
```

## Documentation impact

The final tree actually changes the 20 `tesseract-*` feature folders and `src/memory/features/index.json`. The touch-set documentation-impact surfaces still mention AGENTS, handbook, emit, and context-budget paths, but those Work package B surfaces were reverted and are not present in the final diff.

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [100, 104],
  "contentHash": "851d64e"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/implementation-report.md",
  "range": [131, 152],
  "contentHash": "851d64e"
}
```

```json
{
  "kind": "lines",
  "path": "src/work/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/review.md",
  "range": [71, 73],
  "contentHash": "26b1233"
}
```

## Next operator steps

1. **What:** Review this delivery report and accept the stage.
   **How:** Run `pnpm -w exec tess advance 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants --artifact src/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/delivery-report.md`.

2. **What:** Do not advance the task before human acceptance.
   **How:** Leave the report in place until the operator confirms the final state.
