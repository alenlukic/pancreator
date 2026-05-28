# @daedaline/runner-cursor

Harness boundary: a `CursorRunner` implements `Runner` and returns a structured `RunnerInvocationEnvelope` for a `RunnerPersonaInput` plus user message, without calling a model.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/runner-cursor run build
pnpm --filter @daedaline/runner-cursor test
pnpm --filter @daedaline/runner-cursor run typecheck
```

`RunnerPersonaInput` matches the shape of `PersonaSpec` from `@daedaline/persona` so upstream callers can pass parsed personas without a cross-primitive import inside this package.

## Scope

- This package depends only on `@daedaline/core` and Node built-ins.
- Real LLM or Cursor transport calls are out of scope for this slice.
