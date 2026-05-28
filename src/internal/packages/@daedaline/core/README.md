# @daedaline/core

Shared types and version metadata for Daedaline workspace primitives. The package declares no runtime dependencies and no other `@daedaline/*` workspace dependencies. Downstream packages import only types and small constants from here.

## Quickstart

Run these commands from the repository root after a clone:

1. `pnpm install`
2. `pnpm --filter @daedaline/core run build`
3. `pnpm --filter @daedaline/core exec tsc -p src/internal/packages/@daedaline/core/tsconfig.json`
4. `pnpm --filter @daedaline/core run publint`
5. `pnpm --filter @daedaline/core run attw`
6. `pnpm --filter @daedaline/core exec node --input-type=module -e "import { DAEDALINE_CORE_VERSION } from '@daedaline/core'; console.log(DAEDALINE_CORE_VERSION)"`

The last command prints the package version string and confirms Node resolves the built workspace package.

## API surface

- `DAEDALINE_CORE_VERSION` — semver string for this release.
- `TaskId`, `FeatureId`, `ContentHash` — branded `string` types for stable identifiers.
- `asTaskId`, `asFeatureId`, `asContentHash` — narrow plain strings to those types.
