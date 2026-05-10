# @tesseract/env-isolation

File-backed port registry for environment isolation: exclusive `PORT` blocks per task under `repoRoot/.tess/sandboxes/port-registry.json` (atomic writes, collision detection on load).

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/env-isolation run build
pnpm --filter @tesseract/env-isolation test
pnpm --filter @tesseract/env-isolation run typecheck
```

## Scope

- This package depends only on `@tesseract/core` and Node built-ins.
- Full `EnvIsolation` (compose project names, database names, `.env.tess` hooks) is deferred to later milestones.
