# Delivery Report — cursor-token-economy

## Summary
This Feature reduces default Cursor cache-read volume while preserving explicit access to canonical repo surfaces. It adds a root `.cursorindexingignore`, narrows selected Cursor rule globs, introduces `lib/memory/handbook/context-economy.md` with a routing entry in `lib/memory/handbook/index.md`, splits PRD orientation into `.docs/PRD.summary.md` and `.docs/PRD.index.md`, and adds `lib/internal/tools/context-budget-report.mjs` with matching npm scripts. The implementation keeps `.docs/PRD.md`, `.docs/BOOTSTRAP.md`, `lib/memory/**`, and `.pan/work/**` reachable for explicit reads and records the follow-through in governed work artifacts. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [26, 49],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [44, 76],
  "contentHash": "2dc4848"
}
```


## Architecture
- The slice prefers summary-first retrieval over broad default corpus loading, while preserving explicit reads for `.docs/PRD.md`, `.docs/BOOTSTRAP.md`, `lib/memory/**`, and `.pan/work/**`. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [26, 28],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [44, 50],
  "contentHash": "2dc4848"
}
```

- The indexing policy is repo-tracked through a root `.cursorindexingignore`, and `.gitignore` stops hiding that file so operators can review and reindex it. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [33, 33],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [48, 48],
  "contentHash": "2dc4848"
}
```

- Cursor rule activation narrows to reduce default context load, and `pancreator-engineer` drops broad `.pan/work/**/*` activation unless the rule targets run logs, plans, reviews, or delivery reports. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [34, 35],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [52, 55],
  "contentHash": "2dc4848"
}
```

- Context-budget guidance now lives in `lib/memory/handbook/context-economy.md`, and PRD access splits into `.docs/PRD.summary.md` for orientation and `.docs/PRD.index.md` for section routing. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [37, 39],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [56, 60],
  "contentHash": "2dc4848"
}
```

- Governance stays local to the feature slice: documentation-impact and policy-compliance artifacts accompany the implementation, and deferred work links into the backlog instead of mutating historical artifacts in place. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/plan.md",
  "range": [40, 49],
  "contentHash": "dd39d71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [60, 76],
  "contentHash": "2dc4848"
}
```


## Interfaces
No TypeScript public API changed. The operator-facing surfaces are the repository policy file, the summary-first docs, and the Node CLI plus npm scripts that expose the context-budget report. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [16, 19],
  "contentHash": "fa1a17e"
}
```


- `lib/internal/tools/context-budget-report.mjs` is the new executable entrypoint for rough repository-footprint reporting, and it prints the `whole_repo_text`, `work`, `memory`, `.docs/PRD.md`, `AGENTS.md`, `.cursor`, `personas`, `packages`, `pnpm-lock.yaml`, and generated-manifest scopes. 

```json
{
  "kind": "lines",
  "path": "lib/internal/tools/context-budget-report.mjs",
  "range": [1, 104],
  "contentHash": "6cc94bb"
}
```

- `package.json` adds the `context:budget` and `context:budget:test` scripts so operators can run the report directly or through the Node test harness. 

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [6, 16],
  "contentHash": "22317d8"
}
```

- `.cursorindexingignore` becomes a tracked root policy surface that tells Cursor which high-churn or low-signal paths to avoid by default while preserving explicit reads. 

```json
{
  "kind": "lines",
  "path": ".cursorindexingignore",
  "range": [1, 32],
  "contentHash": "89096be"
}
```

- `.docs/PRD.summary.md` and `.docs/PRD.index.md` add the summary-first and section-routing surfaces that routine readers use before opening full `.docs/PRD.md`. 

```json
{
  "kind": "lines",
  "path": ".docs/PRD.summary.md",
  "range": [1, 38],
  "contentHash": "35226da"
}
```

```json
{
  "kind": "lines",
  "path": ".docs/PRD.index.md",
  "range": [1, 31],
  "contentHash": "e2a3fad"
}
```

- `lib/memory/handbook/context-economy.md` and `lib/memory/handbook/index.md` define the default retrieval discipline and the routing entry that point agents toward the smallest useful surface. 

```json
{
  "kind": "lines",
  "path": "lib/memory/handbook/context-economy.md",
  "range": [29, 73],
  "contentHash": "4e3313a"
}
```

```json
{
  "kind": "lines",
  "path": "lib/memory/handbook/index.md",
  "range": [66, 67],
  "contentHash": "5c703c0"
}
```

- `AGENTS.md` and `README.md` update operator guidance so routine tasks read `.docs/PRD.summary.md` first and treat `/lib/inbox/notes/` as off-limits. 

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [14, 17],
  "contentHash": "b953d77"
}
```

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [97, 101],
  "contentHash": "b953d77"
}
```

```json
{
  "kind": "lines",
  "path": "README.md",
  "range": [22, 38],
  "contentHash": "c32e865"
}
```


## Tradeoffs
- The narrower `.cursor/rules/00-agents-md.mdc` globs may not measurably reduce token load because `alwaysApply: true` still loads the rule on every request, so the slice accepts a possible no-op on that path. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/review.md",
  "range": [52, 55],
  "contentHash": "6dfde3e"
}
```

- The context-budget script uses a directional `chars / 4` heuristic and multiple repository walks, so the report is intentionally rough rather than tokenizer-accurate. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/review.md",
  "range": [55, 55],
  "contentHash": "6dfde3e"
}
```

- The slice preserves the document-first substrate and defers runtime MemoryRouter enforcement, so repository policy changes carry manual verification risk instead of immediate runtime guarantees. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [42, 42],
  "contentHash": "2dc4848"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/adr-draft.md",
  "range": [74, 76],
  "contentHash": "2dc4848"
}
```


## Usage guidelines
- Run `pnpm run context:budget` before and after changing `.cursorindexingignore` or the routing docs, then compare the `Whole repo` section and each scoped line item for a directional before/after delta. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [11, 14],
  "contentHash": "fa1a17e"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [23, 26],
  "contentHash": "fa1a17e"
}
```

- Run `pnpm run context:budget:test` after editing the CLI or its script wiring; the passing test proves the executable exits zero and emits the rough-estimate disclaimer string. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [11, 14],
  "contentHash": "fa1a17e"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-budget-report.test.mjs",
  "range": [5, 16],
  "contentHash": "5aec998"
}
```

- Run `node --test tests/context-budget-report.test.mjs` when you need the smallest direct smoke check for the report surface; the test asserts both the `Whole repo` section and the `chars/4` marker. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [21, 26],
  "contentHash": "fa1a17e"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-budget-report.test.mjs",
  "range": [5, 16],
  "contentHash": "5aec998"
}
```


## Testing
Compared with the prior baseline, this slice adds one spawn-based smoke test for the context-budget CLI and records command-exit coverage rather than line coverage for the doc-and-tooling change set. The implement stage passed `pnpm lint`, `pnpm typecheck`, `pnpm run check:phase0a`, and `pnpm run context:budget:test`, and the review accepted that Istanbul and Vitest did not run on the changed lines. 

```json
{
  "kind": "lines",
  "path": ".pan/archive/work/172997_05-09-26/50909_1000_cursor-token-economy/test-report.md",
  "range": [1, 26],
  "contentHash": "fa1a17e"
}
```

