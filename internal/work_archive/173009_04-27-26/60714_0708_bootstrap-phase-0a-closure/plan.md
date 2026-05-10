# Bootstrap Phase 0a Closure Plan

## Architecture Summary

This slice closes the Phase 0a scaffold gap by turning the existing repository shell into a runnable TypeScript monorepo baseline. The live repo already contains `AGENTS.md`, the always-apply Cursor rule, the canonical top-level directories, `tesseract.yaml`, `tesseract-defaults.yaml`, handbook seeds, personas, skills, and package README placeholders. The live repo lacks root workspace/tooling manifests, package manifests, package `src/index.ts` stubs, declaration-build wiring, a horizontal primitive dependency lint rule, a CI conformance check, and a Phase 0a verification record. The implementation MUST add only those scaffold files and MUST NOT implement Phase 0b handbook content, Phase 0c persona or skill content, Phase 2 contract clauses, or Phase 3 runtime behavior.

## Touch Set

`coder` owns the next implementation pass within these paths:

- Root workspace files: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.changeset/config.json`.
- Tooling files: `tools/eslint-rules/no-horizontal-primitive-deps.mjs`, `internal/tools/check-phase-0a-scaffold.mjs`.
- CI files: `.github/workflows/phase-0a-scaffold.yml`.
- Verification record: `memory/features/bootstrap-phase-0a-closure/phase-0a-verification.md` and `memory/features/bootstrap-phase-0a-closure/index.json`.
- Package skeleton files under every existing `internal/packages/@tesseract/*/` directory: `package.json`, `README.md`, `src/index.ts`.
- Meta package skeleton files under `internal/packages/tesseract/`: `package.json`, `README.md`, `src/index.ts`.

## Execution Steps

1. Reconcile package inventory. `coder` MUST preserve the existing package directories and MUST add only the missing meta package directory `internal/packages/tesseract/` for the unscoped `tesseract` package.
2. Add root monorepo configuration. `coder` MUST configure `pnpm` workspaces and catalogs, Turborepo build dependencies and cache outputs, Changesets linked releases for `@tesseract/*` plus `tesseract`, and root scripts for `build`, `lint`, `lint:deps`, `typecheck`, `attw`, `publint`, and `check:phase0a`.
3. Add package skeletons. `coder` MUST add one manifest and one `src/index.ts` stub per package. Each public package MUST expose `.` through sub-path-ready `exports` and MUST build declarations through `tsup --dts`.
4. Add the dependency boundary guard. `coder` MUST implement `@tesseract/no-horizontal-primitive-deps` as local ESLint rule wiring that fails any primitive import or dependency on another primitive except `@tesseract/core`.
5. Add CI scaffold verification. `coder` MUST wire a CI workflow that installs with `pnpm`, runs build, lint, dependency-boundary lint, type checks, `@arethetypeswrong/cli`, `publint`, and the Phase 0a scaffold checker.
6. Record operator verification. `coder` MUST write the feature verification record with observed commands, package inventory, keep/add/defer decisions, and any failures.

## Verification

- Run `pnpm install`.
- Run `pnpm build`.
- Run `pnpm lint`.
- Run `pnpm lint:deps`.
- Run `pnpm typecheck`.
- Run `pnpm attw`.
- Run `pnpm publint`.
- Run `pnpm check:phase0a`.
- Confirm `git status` shows only Phase 0a scaffold, package skeleton, CI, tooling, and direct verification-record changes.

## Risks And Boundaries

- The existing `internal/packages/@tesseract/contract*` directories remain skeleton-only. This plan includes manifests for them because the directories already exist and the dependency-order bootstrap needs stable package identities, but `coder` MUST NOT add contract runner behavior.
- The root `tesseract.yaml` files already contain Phase 2 policy defaults. `coder` SHOULD leave those files unchanged unless a root script name must be referenced.
- The package README placeholders may stay short. `coder` SHOULD update them only enough to describe package boundary and scaffold status.
- Runtime implementation for `runner-cursor`, `pipeline`, `memory`, `mcp-server`, `cli`, and related packages is deferred to Phase 3.

## Spec Satisfaction Citations

- Acceptance criteria: `{kind: "lines", path: "memory/features/bootstrap-phase-0a-closure/spec.md", range: [49, 71], contentHash: "31994149904e507e81029d40dea33a7d93dde9654ec5f58c0217e1f0a3e97b9c"}`
- Out of scope: `{kind: "lines", path: "memory/features/bootstrap-phase-0a-closure/spec.md", range: [73, 80], contentHash: "31994149904e507e81029d40dea33a7d93dde9654ec5f58c0217e1f0a3e97b9c"}`
- Phase 0a source: `{kind: "lines", path: "BOOTSTRAP.md", range: [36, 57], contentHash: "0f1088bedfa0eb32db30c78399f59cb40c79644249cba812dbe5d7eea6a10b5f"}`
- Package and tooling source: `{kind: "lines", path: "PRD.md", range: [386, 435], contentHash: "6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37"}`
- MVP package source: `{kind: "lines", path: "PRD.md", range: [1114, 1130], contentHash: "6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37"}`
