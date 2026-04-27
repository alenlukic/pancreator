# @tesseract/memory

File-backed `MemoryStore`, handbook `MemoryRouter`, and dual-anchor citation helpers for Tesseract.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/memory run build
pnpm --filter @tesseract/memory test
pnpm --filter @tesseract/memory run typecheck
```

`FileMemoryStore` reads and writes UTF-8 under a `memory/` root. `MemoryRouter` parses `/memory/handbook/index.md` route rows. `verifyDualAnchor` checks `contentHash` values on `DualAnchorCitation` objects.

## Scope

- This package depends only on `@tesseract/core` (and Node built-ins).
- Vector/graph memory and full Letta-tier overlays are out of scope for this slice.
