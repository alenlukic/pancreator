---
title: MCP server — wire the four read-only tools that already have primitives
feature_id: mcp-server-readonly-tool-wireup
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:11Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/mcp-server/
    note: Four tools wired (tess.inbox, tess.pause, tess.resume, tess.abort); eight remain stubs returning {status:"stub"}.
  - kind: path
    path: docs/PRD.md
    note: §11 lists the MCP server as MVP-skeleton; §9 names the verbs as 1:1 with tess CLI grammar; Q18 endorses curated MVP set then expansion.
  - kind: path
    path: src/internal/packages/@tesseract/memory/
    note: FileMemoryStore + MemoryRouter exist; memory.query is implementable today.
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/feature-delivery-run.ts
    note: feature-delivery state machine + status surface already exist; feature.list/show and status are read-only over existing state.
---

# MCP server — wire the four read-only tools that already have primitives

## Problem

`@tesseract/mcp-server` exposes 12 tools but only 4 are implemented; the
other 8 return `{"status":"stub"}`. The four lowest-risk, highest-value
read-only tools (`feature.list`, `feature.show`, `status`,
`memory.query`) are blocked only by handler wiring — every underlying
primitive (`@tesseract/memory`, the feature-delivery state ledger, the
inbox file layout) already exists. External MCP clients see Tesseract as
mostly-stubbed today, undermining the PRD §9 claim that any MCP client can
drive a Tesseract org.

## Goal

Wire the four read-only MCP tools that are blocked only on handler code,
without expanding the surface to write tools or introducing new
primitives.

## Required outcomes

1. `tess.feature.list` returns every feature folder under
   `src/memory/features/` with stable summary fields (`id`, `status`,
   `last_indexed`, `delivery_report_path`).
2. `tess.feature.show <id>` returns the feature's `index.json` plus the
   resolved spec/delivery-report citations.
3. `tess.status [taskId]` returns the active feature-delivery ledger plus
   any intervention overlay (already computed by the CLI).
4. `tess.memory.query "..."` proxies to `MemoryRouter.routeForIntent` and
   returns the loaded context envelope.
5. The four tools share a typed result envelope and propagate
   dual-anchor citation metadata so the MCP client can dereference
   without re-reading the file.

## Acceptance criteria

- A vitest suite invokes each of the four tools through the MCP server's
  stdio transport and asserts the typed result.
- An external MCP client (the operator's Cursor desktop config) can call
  the four tools without seeing `{"status":"stub"}`.
- `@tesseract/mcp-server`'s README lists the wired surface and links to
  the curated-then-expansion plan from Q18.
- The remaining stubs continue to return a structured "not yet
  implemented" result with the milestone tag (see the stub-verb intake
  item).

## Out of scope

- Write tools (`run`, `approve`, `intervention.steer/reroute/snapshot`)
  remain stubs in this slice.
- HTTP transport (M5 scope per PRD §11).
- MCP elicitations (M2 scope per PRD §11).

## Recommended downstream owners

- `tech-lead` for the result-envelope contract.
- `tesseract-engineer` for the four handler implementations and the
  vitest harness.
- `reviewer` for the no-write-surface audit on the slice.
