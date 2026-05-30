# Task List - @pancreator/intervention

- [x] T1: Package scaffold and exports satisfy `pancreator.intervention.package_shape` (`package.json`, `README.md`, `lib/index.ts`).
- [x] T2: README Quickstart lists explicit `pnpm` commands for install, build, test, and typecheck (`pancreator.intervention.readme_ergonomics`).
- [x] T3: Implemented `InterventionState`, `InterventionCommand`, `InterventionRecord`, `InterventionStore` (`FsInterventionStore`, `InMemoryInterventionStore`), `InterventionManager`, `loadActiveState` / `reduceJournalToState`, and LangGraph-shaped helpers (`interruptSignal`, `commandGoto`, `timeTravelTo`).
- [x] T4: Added `vitest` config, `test` / `typecheck` scripts, and unit tests under `lib/**/*.test.ts`.
- [ ] **Deferred:** `@pancreator/cli` wiring for `pan pause | resume | abort` (Phase 3 step 8).
- [ ] **Deferred:** Live LangGraph `interrupt` / `Command` / checkpoint saver integration (structural only in this slice).
- [ ] **Deferred:** Contract runner re-evaluation and llm-judge README gate (human or CI).
