# Task List - @pancreator/cli

- [x] T1: Package scaffold: `bin.pan` → `dist/cli.js`, `lib/cli.ts` + `lib/run.ts`, exports `parseAndRun`, `commander` runtime dependency, workspace deps on `@pancreator/inbox` and `@pancreator/intervention`.
- [x] T2: README Quickstart with explicit `pnpm` build/test/`pan` commands (targets `pancreator.cli.readme_ergonomics`).
- [x] T3: Vitest coverage for `inbox`, `pause`, and unknown-command paths via programmatic `parseAndRun`.
- [x] T4: Stub subcommands (`init`, `run`, `feature`, `status`, `approve`, `memory`, `contracts`, `lint`) emit structured JSON; `pause`/`resume`/`abort` use `InterventionManager` + `FsInterventionStore` under `<repoRoot>/.pan/`.
- [ ] T5 (deferred): Wire `run`, `feature`, `lint`, etc. to real pipeline and contract runners (Phase 4+); add `pan upgrade --apply` when policy upgrade persists to disk.
