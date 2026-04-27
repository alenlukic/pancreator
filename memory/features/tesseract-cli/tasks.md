# Task List - @tesseract/cli

- [x] T1: Package scaffold: `bin.tess` → `dist/cli.js`, `src/cli.ts` + `src/run.ts`, exports `parseAndRun`, `commander` runtime dependency, workspace deps on `@tesseract/inbox` and `@tesseract/intervention`.
- [x] T2: README Quickstart with explicit `pnpm` build/test/`tess` commands (targets `tesseract.cli.readme_ergonomics`).
- [x] T3: Vitest coverage for `inbox`, `pause`, and unknown-command paths via programmatic `parseAndRun`.
- [x] T4: Stub subcommands (`init`, `run`, `feature`, `status`, `approve`, `memory`, `contracts`, `lint`) emit structured JSON; `pause`/`resume`/`abort` use `InterventionManager` + `FsInterventionStore` under `<repoRoot>/.tess/`.
- [ ] T5 (deferred): Wire `run`, `feature`, `lint`, etc. to real pipeline and contract runners (Phase 4+); add `tess upgrade --apply` when policy upgrade persists to disk.
