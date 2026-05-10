# @tesseract/inbox

File-backed access to `/inbox/in/`, `/inbox/out/`, and `/inbox/threads/` for the Tesseract human queue.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/inbox run build
pnpm --filter @tesseract/inbox test
pnpm --filter @tesseract/inbox run typecheck
```

`FileInbox` resolves paths under a repository `inbox/` tree and writes outbound artifacts with `writeOutFile`.

## Scope

- This package depends only on `@tesseract/core` (and Node built-ins).
- MCP elicitation and background archival automation are out of scope for this slice.
