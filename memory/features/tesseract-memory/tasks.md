# Task List - @tesseract/memory

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.memory.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `tesseract.memory.readme_ergonomics` (LLM-judge runs separately when contracts execute).
- [x] T3: Run package conformance checks and capture failures.
- [x] T4: Resolve contract failures with minimal, scoped package edits.
- [x] T5: Re-run contract checks and record green status for Phase 2 completion.

## Slice notes (Phase 3 step 4)

**Done:** `FileMemoryStore`, `MemoryStore`, `MemoryRouter`, dual-anchor helpers (`hashUtf8Content`, `buildLinesDualAnchor`, `buildSymbolDualAnchor`, `verifyDualAnchor`), `readUtf8ForDualAnchor`, feature `index.json` read/write, Vitest + README Quickstart, `typecheck`/`test` scripts. Deprecated `TESSERACT_MEMORY_STUB` / `memoryStubVersion` retained for the `tesseract` meta package.

**Deferred:** Mem0-style semantic memory/search, Letta-tier overlays, `CitationVerification` value `moved`, vector-backed routing, and automatic top-K file loading from route hits (router returns paths only).
