# @pancreator/inbox

File-backed access to `/lib/inbox/in/`, `/lib/inbox/out/`, and `/lib/inbox/threads/` for the Pancreator human queue. The inbox tree is gitignored local storage; operators materialize queue directories on first use.

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/inbox run build
pnpm --filter @pancreator/inbox test
pnpm --filter @pancreator/inbox run typecheck
```

`FileInbox` resolves paths under a repository `lib/inbox/` tree and writes outbound artifacts with `writeOutFile`.

## Scope

- This package depends only on `@pancreator/core` (and Node built-ins).
- MCP elicitation and background archival automation are out of scope for this slice.
