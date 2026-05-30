# @pancreator/env-isolation

File-backed port registry for environment isolation: exclusive `PORT` blocks per task under `repoRoot/.pan/sandboxes/port-registry.json` (atomic writes, collision detection on load).

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/env-isolation run build
pnpm --filter @pancreator/env-isolation test
pnpm --filter @pancreator/env-isolation run typecheck
```

## Scope

- This package depends only on `@pancreator/core` and Node built-ins.
- Full `EnvIsolation` (compose project names, database names, `.env.pan` hooks) is deferred to later milestones.
