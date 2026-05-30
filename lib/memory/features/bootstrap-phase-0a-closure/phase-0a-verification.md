# Phase 0a verification record

**Date (observed).** 2026-04-27  
**Feature id.** `bootstrap-phase-0a-closure`  
**Environment (local).** Node 20+ (see root `package.json` engines), pnpm 9.15.0 (see root `package.json` `packageManager`).

## Package inventory (keep / add)

| Name | Path | Note |
|------|------|------|
| 19 M1-scoped packages | `lib/internal/packages/@pancreator/*` | **Keep** existing directory names. Each now has `package.json`, `README.md`, `lib/index.ts`, and `tsconfig.json` (extends root `tsconfig.base.json` for `tsup` declaration emit). |
| Unscoped meta package | `lib/internal/packages/pancreator` | **Add**; lists every primitive as `workspace:*` and re-exports one stub per package from `lib/index.ts`. |
| Not in this slice | M2+ names in PRD (e.g. `a2a`, `runner-claude`, sandbox adapters) | **Defer**; not in live `packages/`. |

## Decisions and deferrals

- **ATTW.** ESM-only packages: each package `attw` script uses `--profile esm-only` so the check matches the ESM + `type: "module"` layout; strict CJS interop is **deferred** until dual-publish is required.
- **Horizontal deps.** Source: ESLint rule `@pancreator/no-horizontal-primitive-deps`. Manifests: `lib/internal/tools/check-phase-0a-scaffold.mjs` (keys under `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` that are `@pancreator/*`). Meta package `pancreator` may list all primitives; scoped primitives may list only `@pancreator/core` and self.
- **Per-package `tsconfig.json`.** Not listed in the original touch-set file list, but **required** so `tsup` DTS picks up the root `compilerOptions.paths` for `@pancreator/*` resolution during build.

## Observed commands (all exit 0 on this run)

- `pnpm install`
- `pnpm run build`
- `pnpm run lint`
- `pnpm run lint:deps`
- `pnpm run typecheck`
- `pnpm run attw`
- `pnpm run publint`
- `pnpm run check:phase0a`

## Failure handling

- None in the final run after ESLint `ignores` for `tools/**/*.mjs` and ATTW `esm-only` profile.

## Git scope expectation

- Intended to include only: root workspace and tooling, `tools/`, `lib/memory/features/bootstrap-phase-0a-closure/phase-0a-verification.md` and `index.json`, and `packages/**` skeleton files (and `pnpm-lock.yaml`). Build outputs under `dist/` are gitignored; run `pnpm build` and the checks in `OPERATION.md` locally as needed.
