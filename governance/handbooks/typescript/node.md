# TypeScript and Node.js handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Repository TypeScript and TSX MUST conform to [`style-guide.md`](style-guide.md). This handbook adds Node.js runtime and durable-state requirements.

## Modules and dependencies

- Source modules MUST use ES module syntax and NodeNext-compatible `.js` import specifiers.
- Runtime code SHOULD prefer Node.js built-ins when they provide the required behavior clearly.
- A runtime dependency MUST NOT be added without explicit operator approval and a documented operational benefit.
- Development tooling MAY include TypeScript, Prettier, and type declarations required to validate the repository.
- Exported APIs MUST use named exports.

## Type boundaries

- Parsed JSON, CLI arguments, subprocess output, and MCP-derived values MUST enter the system as `unknown` until validated.
- `any` MUST NOT cross a module or API boundary.
- Runtime validation MUST establish an invariant before a type assertion narrows external data.
- Domain values SHOULD use unions or interfaces when a bare primitive would permit invalid states.
- Exported functions SHOULD declare return types when the result is not immediately obvious.

## File I/O and state

- Materialized JSON state MUST be written to a unique temporary file and atomically renamed into place.
- Audit events MUST be appended and MUST NOT be rewritten during ordinary execution.
- Per-run mutations MUST acquire an exclusive lock and MUST recover a provably stale lock deterministically.
- Repository-relative paths MUST remain inside the project root.
- Human-readable JSON MUST use two-space indentation and a trailing newline.
- JSONL event streams SHOULD remain compact.
- Hashing inputs MUST be canonicalized when object key order is not semantically meaningful.

## Subprocess execution

- Fixed commands SHOULD use `spawnSync` or `spawn` with an argument array and no shell.
- A workflow shell criterion MAY use a shell only because its command is reviewed repository configuration rather than agent-generated input.
- Every subprocess MUST define a timeout and bounded output buffer when the API supports them.
- Exit code, stdout, stderr, signal, timing, and timeout state SHOULD be preserved as evidence.
- A timeout MUST fail the criterion rather than leave the workflow hanging.

## Errors and asynchronous code

- Caught errors MUST use `unknown` and MUST be narrowed before property access.
- Internal APIs MUST throw `Error` instances or subclasses.
- The CLI boundary MUST translate known errors into stable machine-readable codes and actionable messages.
- A function MUST NOT be marked `async` unless it awaits or intentionally returns a promise contract.
- Errors MUST be caught only at a boundary that can add context, recover, or render an operator-facing failure.

## Testing and build

- Tests MUST use `node:test` and `node:assert/strict` unless the operator approves another framework.
- Fixtures SHOULD exercise real governance, workflow, and filesystem contracts rather than mocking core I/O.
- Tests MUST cover path escape rejection, lock recovery, atomic write/read behavior, workspace mutation detection, and workflow transitions when those surfaces change.
- `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test`, and applicable repository validation MUST pass before completion.
- Coverage thresholds MUST represent meaningful protection and MUST NOT be lowered only to make a change pass.
