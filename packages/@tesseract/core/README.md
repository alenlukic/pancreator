# @tesseract/core

Shared types and version metadata for Tesseract workspace primitives. The package declares no runtime dependencies and no other `@tesseract/*` workspace dependencies. Downstream packages import only types and small constants from here.

## Quickstart

Run these commands from the repository root after a clone:

1. `pnpm install`
2. `pnpm --filter @tesseract/core run build`
3. `pnpm --filter @tesseract/core exec tsc -p packages/@tesseract/core/tsconfig.json`
4. `pnpm --filter @tesseract/core run publint`
5. `pnpm --filter @tesseract/core run attw`
6. `pnpm --filter @tesseract/core exec node --input-type=module -e "import { TESSERACT_CORE_VERSION } from '@tesseract/core'; console.log(TESSERACT_CORE_VERSION)"`

The last command prints the package version string and confirms Node resolves the built workspace package.

## API surface

- `TESSERACT_CORE_VERSION` — semver string for this release.
- `TaskId`, `FeatureId`, `ContentHash` — branded `string` types for stable identifiers.
- `asTaskId`, `asFeatureId`, `asContentHash` — narrow plain strings to those types.
