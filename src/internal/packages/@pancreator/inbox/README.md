# @pancreator/inbox

File-backed access to `/src/inbox/in/`, `/src/inbox/out/`, and `/src/inbox/threads/` for the Pancreator human queue.

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/inbox run build
pnpm --filter @pancreator/inbox test
pnpm --filter @pancreator/inbox run typecheck
```

`FileInbox` resolves paths under a repository `src/inbox/` tree and writes outbound artifacts with `writeOutFile`.

## Scope

- This package depends only on `@pancreator/core` (and Node built-ins).
- MCP elicitation and background archival automation are out of scope for this slice.
