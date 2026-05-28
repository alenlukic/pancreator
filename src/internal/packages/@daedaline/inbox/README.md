# @daedaline/inbox

File-backed access to `/src/inbox/in/`, `/src/inbox/out/`, and `/src/inbox/threads/` for the Daedaline human queue.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/inbox run build
pnpm --filter @daedaline/inbox test
pnpm --filter @daedaline/inbox run typecheck
```

`FileInbox` resolves paths under a repository `src/inbox/` tree and writes outbound artifacts with `writeOutFile`.

## Scope

- This package depends only on `@daedaline/core` (and Node built-ins).
- MCP elicitation and background archival automation are out of scope for this slice.
