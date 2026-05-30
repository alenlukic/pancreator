# Task List - @pancreator/runner-cursor

- [x] T1: Confirm package scaffold and exported surface satisfy `pancreator.runner_cursor.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `pancreator.runner_cursor.readme_ergonomics` (manual review; LLM-judge contract deferred to CI).
- [x] T3: Implement `Runner` interface, `CursorRunner`, `RunnerInvocationEnvelope`, and `RunnerPersonaInput` (structural; no import of `@pancreator/persona`).
- [x] T4: Vitest for dry-run envelope fields and generated `requestId`.
- [x] T5: `build`, `test`, `typecheck`, `attw`, and `publint` green on Phase 3 step 5 slice.

## Deferred

- Real LLM, Cursor API, or MCP transport.
- Cross-package integration test with `@pancreator/persona` (avoided in-package to keep ESLint horizontal-deps clean; callers compose at a higher layer).
- Byte-equivalent harness replay (BR4) once CLI `pan` lands.
