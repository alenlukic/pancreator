# @tesseract/mcp-server

This package exposes the bootstrap `tess` workspace surface as an MCP server over **stdio**.

## Quickstart

1. Build the package from the repository root:

   ```bash
   pnpm install
   pnpm --filter @tesseract/mcp-server run build
   ```

2. Run the binary (installs resolve `tess-mcp-server` from `node_modules/.bin` when the package is a dependency):

   ```bash
   pnpm -w exec tess-mcp-server
   ```

3. List tools (from an MCP client that speaks stdio JSON-RPC; example names only):

   - `tools/list` returns `tess.init`, `tess.run`, `tess.inbox`, `tess.feature`, `tess.status`, `tess.approve`, `tess.memory`, `tess.contracts`, `tess.lint`, `tess.pause`, `tess.resume`, and `tess.abort`.

## Wired read-only tools (bootstrap)

| MCP tool | Arguments | Envelope command | Notes |
|---|---|---|---|
| `tess.inbox` | `{}` | `inbox` | Lists `src/inbox/in/` entries. |
| `tess.feature` | `{ "action": "list" }` | `feature.list` | Summaries from `src/memory/features/*/index.json`. |
| `tess.feature` | `{ "action": "show", "featureId": "<id>" }` | `feature.show` | Returns index JSON and `spec.md` when present. |
| `tess.status` | `{}` or `{ "taskId": "<id>" }` | `status` | Workspace bootstrap snapshot plus optional task-scoped ledger read. |
| `tess.memory` | `{ "query": "<text>" }` | `memory.query` | Routes through handbook index and active-memory files. |
| `tess.pause` / `tess.resume` / `tess.abort` | task intervention args | `pause` / `resume` / `abort` | Append intervention journal entries. |

4. Call `tess.feature` with `{ "action": "list" }` while the process `cwd` is your Tesseract repository root. The result SHALL return typed JSON, not a stub envelope.

## Deferred write and aggregate tools

The following MCP tools remain deferred to later milestones and emit the structured deferral envelope (`status: "deferred"`) through stdio transport:

| Tool | Milestone | Tracking intake |
|---|---|---|
| `tess.init` | M3 | `src/inbox/in/172981_05-25-26/64500_0605_tess-init-and-create-tesseract-install-paths.md` |
| `tess.run` | M2 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `tess.approve` | M3 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `tess.contracts` | M2 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `tess.lint` | M1 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |

Feature write paths (`feature new`, pipeline orchestration) and HTTP transport remain deferred per Q18 until M2 hardening lands.

## M2 note (Q18)

Full MCP transport hardening, authentication, and multi-session routing are **deferred** to M2 per Q18. This package SHALL keep stdio as the supported transport for the bootstrap skeleton.

## Verification

```bash
pnpm --filter @tesseract/mcp-server run test
pnpm --filter @tesseract/mcp-server run typecheck
```

## See also

- `@tesseract/cli` for the matching `tess` CLI verbs.
- `docs/BOOTSTRAP.md` Phase 3 step 9 for the bootstrap scope statement.
