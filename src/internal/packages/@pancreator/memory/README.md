# @pancreator/memory

File-backed `MemoryStore`, handbook `MemoryRouter`, and dual-anchor citation helpers for Pancreator.

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/memory run build
pnpm --filter @pancreator/memory test
pnpm --filter @pancreator/memory run typecheck
```

`FileMemoryStore` reads and writes UTF-8 under a `src/memory/` root. `MemoryRouter` parses `/src/memory/handbook/index.md` route rows. `verifyDualAnchor` checks `contentHash` values on `DualAnchorCitation` objects.

## Scope

- This package depends only on `@pancreator/core` (and Node built-ins).
- Vector/graph memory and full Letta-tier overlays are out of scope for this slice.
