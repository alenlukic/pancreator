---
id: surface-opt-p2-fix-mcp-work-run-log-path
title: "surface-opt P2 — fix MCP work-run-log:// path"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-01T04:38:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P2
depends_on: []
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p2-mcp-run-log-path.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p2-mcp-run-log-path.md
    range: [33, 90]
    contentHash: ce14705
    note: "Source directive Problem, Goal, Required outcomes (R1, R2), Acceptance criteria (AC1-AC3), and Implementation notes."
  - kind: lines
    path: lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts
    range: [290, 308]
    contentHash: ab080b6
    note: "work-run-log:// handler joins path.join(root, 'work', taskId, 'run.log.jsonl'), omitting the <day> bucket."
  - kind: lines
    path: lib/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts
    range: [212, 239]
    contentHash: ce3c34a
    note: "findStateFile performs the day-aware search across work/<day>/<taskId>/ and archive/work/<day>/<taskId>/."
  - kind: lines
    path: lib/internal/packages/@pancreator/mcp-server/src/definitions.ts
    range: [197, 202]
    contentHash: e77abb1
    note: "pancreator-work-run-log resource description references work/<taskId>/run.log.jsonl, not the work/<day>/<taskId>/ path shape."
---

# Spec — fix MCP `work-run-log://` path

## 1 — Context and motivation

The MCP `work-run-log://<taskId>` resource handler joins
`path.join(root, "work", taskId, "run.log.jsonl")`, so a read resolves to
`work/<taskId>/run.log.jsonl`. The runtime writes the run log to
`work/<day>/<taskId>/run.log.jsonl`, so the handler misses the file and an MCP
run-log read fails. The `findStateFile` helper in `pan-read-handlers.ts` already
searches `work/<day>/<taskId>/` and `archive/work/<day>/<taskId>/` day-aware. This
feature redirects the `work-run-log://` handler through an equivalent day-aware
search and adds 1 regression test so the MCP run-log read returns the real run
log. The fix carries zero state-fidelity risk and ships in Track D step 1 per the
source directive (`75420_0303_surface-opt-p2-mcp-run-log-path.md`).

## 2 — Requirements

**R1** The `work-run-log://<taskId>` handler SHALL resolve the run log through a
day-aware search equivalent to `findStateFile`.

**R2** The `work-run-log://<taskId>` resource description SHALL reference the
`work/<day>/<taskId>/run.log.jsonl` path shape.

**R3** The MCP server test suite SHALL include 1 regression test that asserts the
handler resolves a run log placed under `work/<day>/<taskId>/run.log.jsonl`.

## 3 — Acceptance criteria

- AC1: When an agent reads `work-run-log://<taskId>` for a run whose log lives
  under `work/<day>/<taskId>/run.log.jsonl`, the handler SHALL return that file.
- AC2: When a maintainer reads the `work-run-log://` resource description, the
  description text SHALL reference the `work/<day>/<taskId>/` path shape.
- AC3: When the MCP server test suite runs, the regression test SHALL assert run-log
  resolution for a log placed under `work/<day>/<taskId>/run.log.jsonl`.

## 4 — Touch set (projected)

| Path | Change type | Rationale |
|------|-------------|-----------|
| `lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts` | modify | Resolve the `work-run-log://` run log through a day-aware search instead of `path.join(root, "work", taskId, "run.log.jsonl")` (R1, AC1). |
| `lib/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts` | modify | Reuse or export the `findStateFile`-style day-aware search so the handler resolves `work/<day>/<taskId>/run.log.jsonl` (R1, AC1). |
| `lib/internal/packages/@pancreator/mcp-server/src/definitions.ts` | modify | Update the `pancreator-work-run-log` description to reference the `work/<day>/<taskId>/run.log.jsonl` path shape (R2, AC2). |
| MCP server regression test under `lib/internal/packages/@pancreator/mcp-server` | create/modify | Assert run-log resolution for a log placed under `work/<day>/<taskId>/` (R3, AC3). |

## 5 — Out of scope

- The `memory://` path fix SHALL ship in P1, not this piece (source directive
  Out-of-scope bullet 1).
- This piece SHALL NOT change the CLI or runner engine, reserved for Track O P5–P8
  (source directive Out-of-scope bullet 2).
- This piece SHALL NOT change active memory, agent projections, or the dashboard
  (source directive Out-of-scope bullet 3).
- This piece SHALL NOT change the `state.json` shape (source directive Touch-set
  guard paragraph).

## 6 — Dependencies and sequencing

- This piece depends on no other piece (source directive Dependencies: none).
- This piece SHALL ship in Track D step 1 alongside P1 (source directive Sequencing
  paragraph).

## 7 — Open questions

_None. The source directive states R1, R2, and AC1–AC3 with quantified outcomes and
an explicit touch set, so the clarifying dialogue closes at round 0._

## 8 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-01 | intake-analyst | Initial canonical spec from directive `75420_0303_surface-opt-p2-mcp-run-log-path.md`; 0 clarifying rounds. |
