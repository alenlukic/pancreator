# Implementation report — repository-layout-restructure-and-archive-migration

Task id: `65447_0549_repository-layout-restructure-and-archive-migration`  
Feature id: `repository-layout-restructure-and-archive-migration`

## Summary

Executed the one-shot repository layout migration per spec and touch-set: consolidated archives under top-level `archive/`, moved active work to top-level `work/`, renamed the former `src/` tree to `lib/` (with skills under `lib/personas/skills/`), retired `-standard`/`-complex` agent variants and `subagent-model-tiers.md`, and rewrote runtime, docs, rules, tests, and tooling references. No compatibility shims or fallback path loaders were introduced.

## Structural moves (WP-1 through WP-4)

| Former path | New canonical path |
|---|---|
| `src/inbox/archive/**` | `archive/inbox/**` |
| `src/internal/work_archive/**` | `archive/work/**` |
| `src/work/**` | `work/**` |
| `src/skills/**` | `lib/personas/skills/**` |
| Remaining `src/**` (except notes) | `lib/**` |
| Top-level `src/` | Removed after rename |

Verified on disk: `archive/inbox`, `archive/work`, `work`, `lib`, `lib/inbox/in`, `lib/personas/skills`, `lib/internal/packages`, `lib/memory/handbook`. Top-level `src/` is absent.

## Migration tooling

- **`lib/internal/tools/migrate-repository-layout.mjs`** — dry-run/apply tree moves (`git mv` where applicable), bulk reference rewrites, agent-variant retirement, and skills relocation under `lib/personas/skills/`. Migration mapping files are excluded from reference rewrites so intentional pre-migration path samples remain intact.
- **`lib/internal/tools/validate-repository-layout.mjs`** — post-migration validator for required directories, retired agent variants, and stale `src/` path references on normative surfaces. Migration mapping tables in `migrate-repository-layout.mjs` are excluded from stale-reference scans (they intentionally document former paths).
- **`lib/internal/tools/migrate-repository-layout.test.mjs`** — mapping order, no-shim constraints, deterministic dry-run plans, and pre-migration sample inputs for replacement assertions.

Dry-run after apply reports zero pending tree moves and zero reference rewrites.

## Agent projection simplification (WP-5)

- Deleted all `.cursor/agents/*-standard.md` and `*-complex.md` variant files.
- Updated canonical `.cursor/agents/<name>.md` files with merged `-standard` model policy.
- Removed `lib/memory/handbook/subagent-model-tiers.md`.

## Runtime and reference updates (WP-6)

High-impact surfaces updated include:

- **CLI / MCP:** `feature-delivery-run.ts` (`parseWorkRunDir` expects `work/<day>/<task-id>`), `run.ts`, `active-memory-refresh.ts`, `file-inbox.ts` (inbox root `lib/inbox`), MCP pan-read handlers.
- **Persona emit:** MDC shims use `lib/personas/` paths.
- **Workspace config:** `pnpm-workspace.yaml`, root `package.json` scripts, `tsconfig.base.json`, `.cursorindexingignore`.
- **Internal tools:** `check-phase-0a-scaffold.mjs`, `context-budget-report.mjs`, `migrate-inbox-convention.mjs`, `migrate-timestamp-naming.mjs`, `run-compliance.mjs`, `reformat-markdown-citations.mjs` — all path roots updated from `src/` to `work/` / `lib/`.
- **Rules / hooks / docs:** `.cursor/rules/*.mdc`, `enforce-policy-compliance.sh`, `AGENTS.md`, `OPERATION.md`, `docs/**`.
- **Tests:** `tests/repo-structure.test.mjs`, `tests/context-budget-report.test.mjs`, `tests/migrate-inbox-convention.test.mjs`, `tests/migrate-timestamp-naming.test.mjs`, `tests/run-compliance.test.mjs`, client and package vitest configs (restored package-internal `src/` entry points after blanket rewrite false positives).
- **Workspace symlinks:** `pnpm install` refreshed broken `node_modules/@pancreator/*` links from stale `src/internal/packages/...` to `lib/internal/packages/...`.

## Follow-up fixes in this session

- Removed stale post-migration residue: partial `src/work/` tree recreated during plan→implement SDK advance desync, and orphan `work/172976_05-30-26/64023_0612_repository-layout-restructure-and-archive-migration/` (superseded run without `state.json`).
- `migrate-repository-layout.test.mjs`: sample inputs now use pre-migration `src/...` paths so replacement assertions remain valid after apply.
- `migrate-repository-layout.mjs`: excluded migration tool files from reference rewrites to prevent self-corruption on re-run.
- Pipeline state repaired to `currentStage: implement` with canonical `work/172976_05-30-26/65447_0549_...` artifact paths.

## Review / QA re-entry fixes (bounded)

### Review must-fix — `pancreator` tsconfig extends path

Review flagged `lib/internal/packages/pancreator/tsconfig.json` still using `"extends": "../../../tsconfig.base.json"`, which resolved to non-existent `lib/tsconfig.base.json` after the `src/` → `lib/` rename and produced `TS5083` during package builds. Updated to `"extends": "../../../../tsconfig.base.json"` (four levels up to repository root). Confirmed `pnpm run build` emits no `TS5083` or `error TS` lines.

### QA must-fix — feature index JSON formatting

QA test-report flagged `lib/memory/features/repository-layout-restructure-and-archive-migration/index.json` as non-canonical JSON (missing trailing newline on the empty-object stub). Rewrote the file through canonical `{}` + newline so it matches repository two-space formatting policy. No semantic index content was added; full librarian indexing remains for the `index` stage.

## Validation run

| Command | Result |
|---|---|
| `pnpm test` | pass (79/79 tests; no `TS5083` in build replay) |
| `pnpm run build` | pass (no `TS5083` or `error TS` in output) |
| `node --test tests/*.test.mjs` | pass (102/102 tests) |
| `node --test lib/internal/tools/migrate-repository-layout.test.mjs` | pass (5 tests) |
| `node lib/internal/tools/check-phase-0a-scaffold.mjs` | pass |
| `node lib/internal/tools/context-budget-report.mjs` | pass |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | pass |
| `node lib/internal/tools/validate-repository-layout.mjs` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `node lib/internal/tools/migrate-repository-layout.mjs --dry-run` | pass — zero pending moves/rewrites |
| `pnpm -w exec pan status 65447_0549_repository-layout-restructure-and-archive-migration` | pass — resolves `runDir` under `work/172976_05-30-26/...` |

### Pan smoke notes

- `pan run ... --dry-run` and `pan advance ... --dry-run` are **not supported** by the current CLI (unknown option). Smoke coverage used `pan status` and deferral unit coverage in `tests/repo-structure.test.mjs`.
- `pan advance` with `--artifact` was not executed end-to-end here because it invokes the SDK runner and would mutate pipeline state; operator should run advance after ratifying this report.

## Non-goals honored

- `lib/inbox/notes/**` was not read or modified.
- No compatibility shims, symlinks, or fallback path resolvers were added.
- No git commit or push was performed.

## Known caveats / operator follow-ups

1. **Pipeline status:** Review and QA must-fix items above are addressed in this re-entry; operator should ratify this report and advance back to `review`, then `test`.
2. **Legacy migration tools:** `migrate-inbox-convention.mjs` retains regex patterns matching historical `src/inbox/` and `src/work/` strings for backward-compatible manifest parsing of pre-migration artifacts — intentional, not runtime path resolution.
3. **Blanket rewrite collateral:** Package `tsup`/`vitest`/`tsconfig` paths that were incorrectly rewritten to package-external `lib/` were manually restored to package-internal `src/`; the meta `pancreator` package `extends` path required a separate four-level fix as noted above.
4. **Unrelated workspace diffs:** Pre-existing branch changes outside this touch-set remain in the working tree; review full `git status` before commit.

## Advance command (after human ratification)

```bash
pnpm -w exec pan advance 65447_0549_repository-layout-restructure-and-archive-migration \
  --artifact work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/implementation-report.md
```
