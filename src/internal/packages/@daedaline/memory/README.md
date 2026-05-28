# @daedaline/memory

File-backed `MemoryStore`, handbook `MemoryRouter`, and dual-anchor citation helpers for Daedaline.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/memory run build
pnpm --filter @daedaline/memory test
pnpm --filter @daedaline/memory run typecheck
```

`FileMemoryStore` reads and writes UTF-8 under a `src/memory/` root. `MemoryRouter` parses `/src/memory/handbook/index.md` route rows. `verifyDualAnchor` checks `contentHash` values on `DualAnchorCitation` objects.

## Scope

- This package depends only on `@daedaline/core` (and Node built-ins).
- Vector/graph memory and full Letta-tier overlays are out of scope for this slice.
