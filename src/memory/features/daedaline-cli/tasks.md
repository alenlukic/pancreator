# Task List - @daedaline/cli

- [x] T1: Package scaffold: `bin.ddl` → `dist/cli.js`, `src/cli.ts` + `src/run.ts`, exports `parseAndRun`, `commander` runtime dependency, workspace deps on `@daedaline/inbox` and `@daedaline/intervention`.
- [x] T2: README Quickstart with explicit `pnpm` build/test/`ddl` commands (targets `daedaline.cli.readme_ergonomics`).
- [x] T3: Vitest coverage for `inbox`, `pause`, and unknown-command paths via programmatic `parseAndRun`.
- [x] T4: Stub subcommands (`init`, `run`, `feature`, `status`, `approve`, `memory`, `contracts`, `lint`) emit structured JSON; `pause`/`resume`/`abort` use `InterventionManager` + `FsInterventionStore` under `<repoRoot>/.ddl/`.
- [ ] T5 (deferred): Wire `run`, `feature`, `lint`, etc. to real pipeline and contract runners (Phase 4+); add `ddl upgrade --apply` when policy upgrade persists to disk.
