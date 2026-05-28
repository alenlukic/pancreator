# Delivery Report — cursor-token-economy

## Summary
This Feature reduces default Cursor cache-read volume while preserving explicit access to canonical repo surfaces. It adds a root `.cursorindexingignore`, narrows selected Cursor rule globs, introduces `src/memory/handbook/context-economy.md` with a routing entry in `src/memory/handbook/index.md`, splits PRD orientation into `docs/PRD.summary.md` and `docs/PRD.index.md`, and adds `src/internal/tools/context-budget-report.mjs` with matching npm scripts. The implementation keeps `docs/PRD.md`, `docs/BOOTSTRAP.md`, `src/memory/**`, and `src/work/**` reachable for explicit reads and records the follow-through in governed work artifacts. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [26, 49],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [44, 76],
  "contentHash": "25f6362"
}
```


## Architecture
- The slice prefers summary-first retrieval over broad default corpus loading, while preserving explicit reads for `docs/PRD.md`, `docs/BOOTSTRAP.md`, `src/memory/**`, and `src/work/**`. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [26, 28],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [44, 50],
  "contentHash": "25f6362"
}
```

- The indexing policy is repo-tracked through a root `.cursorindexingignore`, and `.gitignore` stops hiding that file so operators can review and reindex it. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [33, 33],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [48, 48],
  "contentHash": "25f6362"
}
```

- Cursor rule activation narrows to reduce default context load, and `daedaline-engineer` drops broad `src/work/**/*` activation unless the rule targets run logs, plans, reviews, or delivery reports. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [34, 35],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [52, 55],
  "contentHash": "25f6362"
}
```

- Context-budget guidance now lives in `src/memory/handbook/context-economy.md`, and PRD access splits into `docs/PRD.summary.md` for orientation and `docs/PRD.index.md` for section routing. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [37, 39],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [56, 60],
  "contentHash": "25f6362"
}
```

- Governance stays local to the feature slice: documentation-impact and policy-compliance artifacts accompany the implementation, and deferred work links into the backlog instead of mutating historical artifacts in place. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [40, 49],
  "contentHash": "a9e0696"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [60, 76],
  "contentHash": "25f6362"
}
```


## Interfaces
No TypeScript public API changed. The operator-facing surfaces are the repository policy file, the summary-first docs, and the Node CLI plus npm scripts that expose the context-budget report. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [16, 19],
  "contentHash": "607f40d"
}
```


- `src/internal/tools/context-budget-report.mjs` is the new executable entrypoint for rough repository-footprint reporting, and it prints the `whole_repo_text`, `work`, `memory`, `docs/PRD.md`, `AGENTS.md`, `.cursor`, `personas`, `packages`, `pnpm-lock.yaml`, and generated-manifest scopes. 

```json
{
  "kind": "lines",
  "path": "src/internal/tools/context-budget-report.mjs",
  "range": [1, 104],
  "contentHash": "453d708"
}
```

- `package.json` adds the `context:budget` and `context:budget:test` scripts so operators can run the report directly or through the Node test harness. 

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [6, 16],
  "contentHash": "ef10f9f"
}
```

- `.cursorindexingignore` becomes a tracked root policy surface that tells Cursor which high-churn or low-signal paths to avoid by default while preserving explicit reads. 

```json
{
  "kind": "lines",
  "path": ".cursorindexingignore",
  "range": [1, 32],
  "contentHash": "3ef42bf"
}
```

- `docs/PRD.summary.md` and `docs/PRD.index.md` add the summary-first and section-routing surfaces that routine readers use before opening full `docs/PRD.md`. 

```json
{
  "kind": "lines",
  "path": "docs/PRD.summary.md",
  "range": [1, 38],
  "contentHash": "dd492c8"
}
```

```json
{
  "kind": "lines",
  "path": "docs/PRD.index.md",
  "range": [1, 31],
  "contentHash": "e53bf74"
}
```

- `src/memory/handbook/context-economy.md` and `src/memory/handbook/index.md` define the default retrieval discipline and the routing entry that point agents toward the smallest useful surface. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/context-economy.md",
  "range": [29, 73],
  "contentHash": "8640ae6"
}
```

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/index.md",
  "range": [66, 67],
  "contentHash": "bc5cff7"
}
```

- `AGENTS.md` and `README.md` update operator guidance so routine tasks read `docs/PRD.summary.md` first and treat `/src/inbox/notes/` as off-limits. 

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [14, 17],
  "contentHash": "f2d87ec"
}
```

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [97, 101],
  "contentHash": "f2d87ec"
}
```

```json
{
  "kind": "lines",
  "path": "README.md",
  "range": [22, 38],
  "contentHash": "fae1149"
}
```


## Tradeoffs
- The narrower `.cursor/rules/00-agents-md.mdc` globs may not measurably reduce token load because `alwaysApply: true` still loads the rule on every request, so the slice accepts a possible no-op on that path. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/review.md",
  "range": [52, 55],
  "contentHash": "95d00d4"
}
```

- The context-budget script uses a directional `chars / 4` heuristic and multiple repository walks, so the report is intentionally rough rather than tokenizer-accurate. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/review.md",
  "range": [55, 55],
  "contentHash": "95d00d4"
}
```

- The slice preserves the document-first substrate and defers runtime MemoryRouter enforcement, so repository policy changes carry manual verification risk instead of immediate runtime guarantees. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [42, 42],
  "contentHash": "25f6362"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [74, 76],
  "contentHash": "25f6362"
}
```


## Usage guidelines
- Run `pnpm run context:budget` before and after changing `.cursorindexingignore` or the routing docs, then compare the `Whole repo` section and each scoped line item for a directional before/after delta. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [11, 14],
  "contentHash": "607f40d"
}
```

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [23, 26],
  "contentHash": "607f40d"
}
```

- Run `pnpm run context:budget:test` after editing the CLI or its script wiring; the passing test proves the executable exits zero and emits the rough-estimate disclaimer string. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [11, 14],
  "contentHash": "607f40d"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-budget-report.test.mjs",
  "range": [5, 16],
  "contentHash": "37d1b64"
}
```

- Run `node --test tests/context-budget-report.test.mjs` when you need the smallest direct smoke check for the report surface; the test asserts both the `Whole repo` section and the `chars/4` marker. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [21, 26],
  "contentHash": "607f40d"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-budget-report.test.mjs",
  "range": [5, 16],
  "contentHash": "37d1b64"
}
```


## Testing
Compared with the prior baseline, this slice adds one spawn-based smoke test for the context-budget CLI and records command-exit coverage rather than line coverage for the doc-and-tooling change set. The implement stage passed `pnpm lint`, `pnpm typecheck`, `pnpm run check:phase0a`, and `pnpm run context:budget:test`, and the review accepted that Istanbul and Vitest did not run on the changed lines. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [1, 26],
  "contentHash": "607f40d"
}
```

