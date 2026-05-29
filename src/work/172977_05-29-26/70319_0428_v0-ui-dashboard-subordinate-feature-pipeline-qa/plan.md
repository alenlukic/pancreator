# Plan — v0 UI dashboard subordinate feature QA

The implement stage SHALL build a runnable v0 Next.js dashboard in top-level `client/` with repository navigation, relationship-aware structure, inline modal file viewing/editing, and reverse-chron activity feed backed by API routes. The stage SHALL also produce passing core tests and document one-command local startup. This plan executes the corrective action for the earlier false QA closure by requiring actual implementation evidence before review/test ratification.

## Implementation phases

1. **Scaffold client app and workspace wiring**
   - Create `client/` as a Next.js App Router project with TypeScript and modern tooling.
   - Add `client` to `pnpm-workspace.yaml` and install required dependencies.
   - Add a dashboard-focused `client/README.md` with local run/test commands.

2. **Implement repository API endpoints**
   - Add server routes for:
     - repo activity feed (`GET /api/activity`) returning reverse-chron human-readable events.
     - file read (`GET /api/file?path=`) returning text content for allowed paths.
     - file write (`POST /api/file`) persisting edits to allowed paths.
   - Add guardrails that block traversal and edits outside repository boundaries.

3. **Implement dashboard UX**
   - Build a responsive layout with a modern component library and palette tokens:
     - `#05031B`, `#BBD8B3`, `#A22C29`, `#FFB400`.
   - Provide clear navigation for core areas (`inbox`, `memory`, `personas`, `work`, internal packages).
   - Show relationship context between sections and file groups.
   - Implement collapsible inline modal panels for file preview/edit.
   - Implement save/update flow against `/api/file`.
   - Render reverse-chron activity feed with readable timestamps and event text.

4. **Add test coverage and verify runtime**
   - Add unit/integration tests for API route behavior (activity ordering, file read, file write guardrails).
   - Add UI tests for navigation rendering, modal open/edit flow, and activity feed display.
   - Run targeted client tests and repo validation commands before stage advance.

## Validation strategy

Run before implementation handoff:

```bash
pnpm --filter client test
pnpm --filter client lint
pnpm --filter client build
node --test tests/*.test.mjs
node src/internal/tools/check-phase-0a-scaffold.mjs
node src/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
```

## Documentation impact decision

```yaml
documentation_impact:
  applies: true
  rationale: "The subordinate dashboard introduces a new top-level application surface, operator startup/testing instructions, and API/UI behavior that must be discoverable for QA evidence."
  changed-surfaces:
    - client/README.md
    - pnpm-workspace.yaml
    - package.json
  deferred-items: []
```
