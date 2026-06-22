# TypeScript and Node.js handbook

The language baseline for harness and tooling code. The Pancreator harness is
dependency-free ESM Node.js (`.mjs`); product code may use TypeScript. These
practices reflect the patterns already in `src/lib` and should be preserved.

## Modules and runtime

- Use ESM throughout (`import`/`export`, `"type": "module"`). No CommonJS in new
  code.
- Prefer Node built-ins over dependencies. The harness has zero runtime
  dependencies and no build step; keep it that way. A new dependency is a
  decision with a justification, not a convenience.
- Target the supported runtime (Node 22+). Use built-in capabilities -
  `node:test`, `node:crypto`, `structuredClone`, the test runner's coverage -
  before reaching for a package.
- Use explicit `node:` import specifiers for built-ins.

## Types and shapes

- In TypeScript, prefer precise types over `any`. Model domain values as branded
  or literal-union types where a bare `string` would invite mistakes.
- In untyped ESM, validate shapes explicitly at boundaries. Check
  `schema_version`, required fields, and value domains before acting on parsed
  JSON, exactly as `validateStageOutput` does.
- Keep public function signatures small and named. Pass an options object rather
  than a long positional list. Document non-obvious contracts with JSDoc.

## Input validation at boundaries

- Validate every input that crosses a file or process boundary: parsed JSON,
  CLI arguments, command output, and external content. Trust values only after
  validation.
- Reject path escapes. Resolve repository-relative paths and confirm they stay
  inside the project root before any read or write (`resolveInside`,
  `toRepoRelative`).
- Raise typed, coded errors. Use a single error type carrying a stable `code`,
  optional `details`, and an exit code, so the CLI can render machine-readable
  failures (`PanError`, `invariant`).

## File I/O and durable state

- Replace materialized state atomically. Write to a unique temp file, then
  rename into place (`writeJsonAtomic`, `writeTextAtomic`). Never write a
  half-formed `state.json`.
- Keep audit history append-only. Event logs are appended, never rewritten
  (`appendJsonLine`), so a run is reconstructable from its events.
- Serialize concurrent mutations. Guard per-run state changes with an exclusive
  file lock and recover stale locks deterministically (`withFileLock`).
- Make hashing stable and deterministic. Hash canonicalized input so equal
  values hash equally regardless of key order (`stableStringify`, `sha256`).
- Pretty-print JSON written for humans (two-space indent, trailing newline).
  Machine-only streams (JSONL events) stay compact.

## Subprocess and shell safety

- Never build a shell command from agent-controlled or external strings.
- Prefer `spawnSync` with an argument array and no shell for fixed commands.
  When a stage runs a declared gate command, pass it through a controlled,
  reviewed path with an explicit timeout and bounded buffer, and capture
  stdout, stderr, exit code, and timing as evidence.
- Always set a timeout and a `maxBuffer` for child processes; treat a timeout as
  a failure, not a hang.

## Async and errors

- Keep the async surface honest. Mark functions `async` only when they await;
  do not wrap synchronous logic in needless promises.
- Handle the failure path explicitly. Catch at the boundary that can act on the
  error, attach context, and re-throw typed errors rather than swallowing them.
- Fail fast on programmer errors (invariants); degrade gracefully on expected
  operational errors (a missing optional file, a stale lock).

## Testing in Node

- Use the built-in `node:test` runner and `node:assert/strict`.
- Build realistic fixtures. Construct a temporary repository with the real
  `library/`, `governance/`, and `.cursor/` inputs rather than mocking I/O, so
  tests exercise the actual file contracts.
- Cover the boundaries that matter: path-escape rejection, lock serialization,
  atomic write/read round-trips, workspace-change detection, and full-workflow
  transitions. Keep coverage thresholds meaningful, not decorative.
