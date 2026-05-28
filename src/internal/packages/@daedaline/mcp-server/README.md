# @daedaline/mcp-server

This package exposes the bootstrap `ddl` workspace surface as an MCP server over **stdio**.

## Quickstart

1. Build the package from the repository root:

   ```bash
   pnpm install
   pnpm --filter @daedaline/mcp-server run build
   ```

2. Run the binary (installs resolve `ddl-mcp-server` from `node_modules/.bin` when the package is a dependency):

   ```bash
   pnpm -w exec ddl-mcp-server
   ```

3. List tools (from an MCP client that speaks stdio JSON-RPC; example names only):

   - `tools/list` returns `ddl.init`, `ddl.run`, `ddl.inbox`, `ddl.feature`, `ddl.status`, `ddl.approve`, `ddl.memory`, `ddl.contracts`, `ddl.lint`, `ddl.pause`, `ddl.resume`, and `ddl.abort`.

## Wired read-only tools (bootstrap)

| MCP tool | Arguments | Envelope command | Notes |
|---|---|---|---|
| `ddl.inbox` | `{}` | `inbox` | Lists `src/inbox/in/` entries. |
| `ddl.feature` | `{ "action": "list" }` | `feature.list` | Summaries from `src/memory/features/*/index.json`. |
| `ddl.feature` | `{ "action": "show", "featureId": "<id>" }` | `feature.show` | Returns index JSON and `spec.md` when present. |
| `ddl.status` | `{}` or `{ "taskId": "<id>" }` | `status` | Workspace bootstrap snapshot plus optional task-scoped ledger read. |
| `ddl.memory` | `{ "query": "<text>" }` | `memory.query` | Routes through handbook index and active-memory files. |
| `ddl.pause` / `ddl.resume` / `ddl.abort` | task intervention args | `pause` / `resume` / `abort` | Append intervention journal entries. |

4. Call `ddl.feature` with `{ "action": "list" }` while the process `cwd` is your Daedaline repository root. The result SHALL return typed JSON, not a stub envelope.

## Deferred write and aggregate tools

The following MCP tools remain deferred to later milestones and emit the structured deferral envelope (`status: "deferred"`) through stdio transport:

| Tool | Milestone | Tracking intake |
|---|---|---|
| `ddl.init` | M3 | `src/inbox/in/172981_05-25-26/64500_0605_ddl-init-and-create-daedaline-install-paths.md` |
| `ddl.run` | M2 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `ddl.approve` | M3 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `ddl.contracts` | M2 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `ddl.lint` | M1 | `src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |

Feature write paths (`feature new`, pipeline orchestration) and HTTP transport remain deferred per Q18 until M2 hardening lands.

## M2 note (Q18)

Full MCP transport hardening, authentication, and multi-session routing are **deferred** to M2 per Q18. This package SHALL keep stdio as the supported transport for the bootstrap skeleton.

## Verification

```bash
pnpm --filter @daedaline/mcp-server run test
pnpm --filter @daedaline/mcp-server run typecheck
```

## See also

- `@daedaline/cli` for the matching `ddl` CLI verbs.
- `docs/BOOTSTRAP.md` Phase 3 step 9 for the bootstrap scope statement.
