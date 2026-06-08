---
title: TypeScript and ES2022 Style Guide
slug: engineering-typescript
stability: experimental
bootstrap-only: false
phase: 0b
owners: [reviewer, coder, pancreator-engineer]
purpose: |
  Standards for modern TypeScript using current stable TypeScript, ES2022+
  language features, and ESM-aware tooling across browser and Node runtimes.
  Agents authoring or modifying TypeScript SHALL prefer type safety, runtime
  correctness, maintainability, and clear JavaScript output over type-level
  cleverness.
references:
  - kind: lines
    path: lib/memory/handbook/engineering/index.md
    range: [1, 1]
    contentHash: 990527f
    note: "Engineering standards index routes TypeScript activities to this page."
  - kind: lines
    path: lib/memory/handbook/engineering/software-engineering.md
    range: [1, 1]
    contentHash: 9d6c834
    note: "This guide layers on top of the general software-engineering standard."
related:
  - /lib/memory/handbook/engineering/index.md
  - /lib/memory/handbook/engineering/software-engineering.md
---

# TypeScript and ES2022 Style Guide

This guide layers on top of `/lib/memory/handbook/engineering/software-engineering.md`.
It applies to TypeScript libraries, services, frontend apps, and tests targeting
ES2022+ language features and ESM-aware tooling. Agents SHALL prefer type safety,
runtime correctness, and clear JavaScript output over type-level cleverness.

## Standards

### 1 — Strict TypeScript as the default

Agents SHALL enable `strict` unless the project documents a deliberate migration
constraint. Agents SHALL prefer `unknown` over `any` for untrusted or unvalidated
values and SHALL avoid `any`; where `any` is unavoidable, agents SHALL isolate it at
the boundary and SHALL explain why. Agents SHALL prefer `satisfies` to check object
conformance without widening away useful literal types, SHALL use `as const` when
literal precision is meaningful, and SHALL avoid unsafe assertions unless runtime
facts are already guaranteed.

### 2 — Model states explicitly

Agents SHALL prefer discriminated unions for finite state machines, async states,
command results, and variant domain objects. Agents SHALL use exhaustive checks with
`never` for important branching logic and SHALL make nullable and optional states
intentional. Agents SHALL NOT replace named states with boolean flag soup and SHALL
NOT encode domain uncertainty as loose objects or stringly typed conventions.

### 3 — Keep runtime validation separate from static typing

Agents SHALL treat TypeScript types as compile-time only and SHALL validate external
input at trust boundaries: APIs, forms, files, queues, storage, environment
variables, and third-party services. Agents SHALL use schema validation where shape,
safety, or error quality matters and SHALL NOT assume JSON, URL params,
`localStorage`, or server responses match declared types.

### 4 — Prefer modern ES2022+ features when they clarify intent

Agents SHALL use native private fields only when true runtime privacy is needed,
SHALL use optional chaining and nullish coalescing for clear nullable handling, and
SHALL use `Array.prototype.at()` when negative indexing improves clarity. Agents
SHALL use top-level `await` only in module contexts where startup sequencing remains
understandable, SHALL use `Error.cause` to preserve failure chains, and SHALL avoid
novelty syntax when conventional code is clearer.

### 5 — Keep module boundaries clean

Agents SHALL prefer ESM for new code unless project or runtime constraints require
otherwise, SHALL avoid circular dependencies, and SHALL keep imports explicit and
stable. Agents SHALL separate domain logic from framework, transport, persistence,
and UI glue, and SHALL avoid barrel files that hide dependency direction or create
cycles.

### 6 — Design functions and APIs for readability

Agents SHALL prefer explicit parameter objects for functions with multiple related
options, SHALL use precise return types at public boundaries, and SHALL avoid
over-generic helpers that require complex inference to understand. Agents SHALL
prefer plain data and pure functions where practical and SHALL NOT require callers to
understand internal implementation details.

### 7 — Use generics sparingly and clearly

Agents SHALL use generics to preserve real relationships between inputs and outputs,
SHALL prefer constrained generics over unconstrained placeholders, and SHALL keep
exported generic APIs readable. Agents SHALL NOT write type gymnastics that make
simple code inaccessible and SHALL NOT encode large business rules purely in types
when runtime behavior still needs validation.

### 8 — Handle async and errors deliberately

Agents SHALL handle promises intentionally and SHALL NOT leave floating promises
unless explicitly marked and safe. Agents SHALL use `AbortController` or equivalent
cancellation where long-running async work can be abandoned, SHALL preserve error
context, and SHALL NOT throw raw strings or unstructured values. Agents SHALL keep
retry, timeout, fallback, and partial-failure behavior explicit.

### 9 — Avoid mutation surprises

Agents SHALL prefer immutable updates for shared data and state, SHALL use `readonly`
for arrays, objects, and fields that should not mutate, and SHALL NOT mutate function
arguments unless the function name and contract make that clear. Agents SHALL keep
mutable caches and registries encapsulated.

### 10 — Write pragmatic tests

Agents SHALL test core business logic, critical flows, edge cases, and regression
cases, and SHALL prefer behavior-focused tests over implementation-mirroring tests.
Agents SHALL use type tests only for important exported type contracts or tricky
inference behavior, SHALL mock external systems at boundaries rather than ordinary
internal functions, and SHALL NOT chase 100 percent coverage when tests become
brittle or low signal.

### 11 — Keep build and tooling coherent

Agents SHALL respect the project's `tsconfig`, bundler, package manager, lint, and
formatter choices, and SHALL avoid introducing new transpilation assumptions
casually. Agents SHALL keep `target`, `module`, `moduleResolution`, and runtime
expectations aligned, and SHALL NOT rely on features unsupported by the declared
runtime or browser baseline. Agents SHALL prefer automated linting, formatting,
type-checking, and test gates.

### 12 — Protect security and trust boundaries

Agents SHALL sanitize or encode untrusted data before rendering, storing, querying,
or shelling out, and SHALL avoid unsafe dynamic property access, eval-like behavior,
and string-built queries. Agents SHALL NOT leak secrets into client bundles, logs,
errors, or test fixtures, and SHALL treat auth, authorization, payment, admin, and
data-export paths as critical paths.

## Acceptance criteria

TypeScript work conforms to this guide when:

- `any` is avoided or isolated with justification.
- External inputs are validated before trusted use.
- State modeling is explicit and exhaustively handled where important.
- Async work handles failure, cancellation, and lifecycle concerns.
- Type-level complexity is justified by real clarity or safety gains.
- Module boundaries are coherent and free of avoidable cycles.
- Tests cover meaningful behavior rather than implementation trivia.
- Runtime targets and TypeScript configuration remain aligned.

## Validation

Agents SHALL prefer the following checks, scoped to the change:

- `tsc --noEmit` or the project-equivalent type check.
- Unit tests for domain logic.
- Integration tests for API, persistence, and runtime boundaries.
- Lint and format checks from the project configuration.
- Build verification when module, target, or bundler behavior is touched.

Agents SHALL NOT require 100 percent coverage unless the project mandates it.

## Stability

This page is an engineering-standards seed and remains `experimental` until
standards-conformance checks are implemented and validated.
