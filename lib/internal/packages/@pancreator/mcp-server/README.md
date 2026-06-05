# @pancreator/mcp-server

This package exposes the bootstrap `pan` workspace surface as an MCP server over **stdio**.

## Quickstart

1. Build the package from the repository root:

   ```bash
   pnpm install
   pnpm --filter @pancreator/mcp-server run build
   ```

2. Run the binary (installs resolve `pan-mcp-server` from `node_modules/.bin` when the package is a dependency):

   ```bash
   pnpm -w exec pan-mcp-server
   ```

3. List tools (from an MCP client that speaks stdio JSON-RPC; example names only):

   - `tools/list` returns `pan.init`, `pan.run`, `pan.inbox`, `pan.feature`, `pan.status`, `pan.approve`, `pan.memory`, `pan.contracts`, `pan.lint`, `pan.pause`, `pan.resume`, and `pan.abort`.

## Wired read-only tools (bootstrap)

| MCP tool | Arguments | Envelope command | Notes |
|---|---|---|---|
| `pan.inbox` | `{}` | `inbox` | Lists `lib/inbox/in/` entries. |
| `pan.feature` | `{ "action": "list" }` | `feature.list` | Summaries from `lib/memory/features/*/index.json`. |
| `pan.feature` | `{ "action": "show", "featureId": "<id>" }` | `feature.show` | Returns index JSON and `spec.md` when present. |
| `pan.status` | `{}` or `{ "taskId": "<id>" }` | `status` | Parsed `pancreator.yaml` plus optional task-scoped ledger read. |
| `pan.memory` | `{ "query": "<text>" }` | `memory.query` | Routes through handbook index and active-memory files. |
| `pan.pause` / `pan.resume` / `pan.abort` | task intervention args | `pause` / `resume` / `abort` | Append intervention journal entries. |

4. Call `pan.feature` with `{ "action": "list" }` while the process `cwd` is your Pancreator repository root. The result SHALL return typed JSON, not a stub envelope.

## Deferred write and aggregate tools

The following MCP tools remain deferred to later milestones and emit the structured deferral envelope (`status: "deferred"`) through stdio transport:

| Tool | Milestone | Tracking intake |
|---|---|---|
| `pan.init` | M3 | `lib/inbox/in/172981_05-25-26/64500_0605_pan-init-and-create-pancreator-install-paths.md` |
| `pan.run` | M2 | `lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `pan.approve` | M3 | `lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `pan.contracts` | M2 | `lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `pan.lint` | M1 | `lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |

Feature write paths (`feature new`, pipeline orchestration) and HTTP transport remain deferred per Q18 until M2 hardening lands.

## M2 note (Q18)

Full MCP transport hardening, authentication, and multi-session routing are **deferred** to M2 per Q18. This package SHALL keep stdio as the supported transport for the bootstrap skeleton.

## Verification

```bash
pnpm --filter @pancreator/mcp-server run test
pnpm --filter @pancreator/mcp-server run typecheck
```

## See also

- `@pancreator/cli` for the matching `pan` CLI verbs.
- `docs/BOOTSTRAP.md` Phase 3 step 9 for the bootstrap scope statement.
