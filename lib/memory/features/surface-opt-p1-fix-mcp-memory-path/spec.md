---
id: surface-opt-p1-fix-mcp-memory-path
title: "surface-opt P1 — fix MCP memory:// path"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-01T04:10:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P1
depends_on: []
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p1-mcp-memory-path.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p1-mcp-memory-path.md
    range: [33, 67]
    contentHash: cfddc3c
    note: "Source directive Problem, Goal, Required outcomes (R1, R2), and Acceptance criteria (AC1-AC3)."
  - kind: lines
    path: lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts
    range: [258, 270]
    contentHash: 89255e3
    note: "`memory://` handler joins path.join(root, 'memory'); memoryRoot feeds listDirNames and FileMemoryStore at lines 260-261."
  - kind: lines
    path: lib/internal/packages/@pancreator/mcp-server/src/definitions.ts
    range: [183, 189]
    contentHash: e93abf8
    note: "`pancreator-memory-areas` resource description references `/lib/memory/` but not `/lib/memory/<area>/`."
---

# Spec — fix MCP `memory://` path

## 1 — Context and motivation

The MCP `memory://` resource handler joins `path.join(root, "memory")`, so a read
resolves to `<root>/memory`, a directory the repository does not contain. The
handler advertises `/lib/memory/<area>/` in its returned JSON and doc comment. When
an agent reads memory through MCP, the handler returns an empty area listing, which
pushes the agent toward broad file reads. This feature redirects the handler to
`path.join(root, "lib/memory")` and adds one regression test so the MCP memory read
returns the real memory tree. The fix carries zero state-fidelity risk and ships in
Track D step 1 per the source directive (`75420_0303_surface-opt-p1-mcp-memory-path.md`).

## 2 — Requirements

**R1** The `memory://` handler SHALL resolve the memory root to
`path.join(root, "lib/memory")`.

**R2** The `memory://` resource description SHALL reference `/lib/memory/<area>/`.

**R3** The MCP server test suite SHALL include one regression test that asserts the
resolved `memory://` path ends with `lib/memory`.

## 3 — Acceptance criteria

- AC1: When the MCP server reads the `memory://` resource, the handler SHALL set the
  memory root to `path.join(root, "lib/memory")`.
- AC2: When a maintainer reads the `memory://` resource description, the description
  text SHALL reference `/lib/memory/<area>/`.
- AC3: When the MCP server test suite runs, the regression test SHALL assert that the
  resolved `memory://` path ends with `lib/memory`.

## 4 — Touch set (projected)

| Path | Change type | Rationale |
|------|-------------|-----------|
| `lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts` | modify | Redirect `memoryRoot` to `path.join(root, "lib/memory")` (R1, AC1). |
| `lib/internal/packages/@pancreator/mcp-server/src/definitions.ts` | modify | Update the `pancreator-memory-areas` description to reference `/lib/memory/<area>/` (R2, AC2). |
| MCP server regression test under `lib/internal/packages/@pancreator/mcp-server` | create/modify | Assert the resolved `memory://` path ends with `lib/memory` (R3, AC3). |

## 5 — Out of scope

- The `work-run-log://` path fix SHALL ship in P2, not this piece (source directive
  Out-of-scope bullet 1).
- This piece SHALL NOT change the CLI or runner engine, reserved for Track O P5–P8
  (source directive Out-of-scope bullet 2).
- This piece SHALL NOT change active memory, agent projections, or the dashboard
  (source directive Out-of-scope bullet 3).
- This piece SHALL NOT change the `state.json` shape (source directive Touch-set
  guard paragraph).

## 6 — Dependencies and sequencing

- This piece depends on no other piece (source directive Dependencies: none).
- This piece SHALL ship in Track D step 1 alongside P2 (source directive Sequencing
  paragraph).

## 7 — Open questions

_None. The source directive states R1, R2, and AC1–AC3 with quantified outcomes, so
the clarifying dialogue closes at round 0._

## 8 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-01 | intake-analyst | Initial canonical spec from directive `75420_0303_surface-opt-p1-mcp-memory-path.md`; 0 clarifying rounds. |
