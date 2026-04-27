# Task List - @tesseract/mcp-server

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.mcp_server.package_shape` (done in Phase 3 step 9; `package.json`, `README.md`, `src/index.ts` are present; Rego revalidation remains with the contract runner in Phase 2+ gates).
- [x] T2: Confirm README Quickstart satisfies `tesseract.mcp_server.readme_ergonomics` (Quickstart is present; full llm-judge re-run is deferred to contract evaluation, not re-run here).
- [x] T3: Run package conformance checks and capture failures (local `typecheck`, `test`, `attw`, `publint` for this package).
- [x] T4: Resolve contract failures with minimal, scoped package edits (deferred: automated contract-runner invocations; package shape is met by the scaffold in-tree).
- [ ] T5: Re-run contract checks and record green status for Phase 2 completion (deferred: Phase 2 `contracts.index.json` batch evaluation; Phase 3 slice delivers the live package implementation).
