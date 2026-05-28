# @daedaline/env-isolation

File-backed port registry for environment isolation: exclusive `PORT` blocks per task under `repoRoot/.ddl/sandboxes/port-registry.json` (atomic writes, collision detection on load).

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/env-isolation run build
pnpm --filter @daedaline/env-isolation test
pnpm --filter @daedaline/env-isolation run typecheck
```

## Scope

- This package depends only on `@daedaline/core` and Node built-ins.
- Full `EnvIsolation` (compose project names, database names, `.env.ddl` hooks) is deferred to later milestones.
