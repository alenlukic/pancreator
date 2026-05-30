# Implementation report — feature-delivery harness CursorRunner wiring (qa_fails re-entry)

Task: `24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance`  
Stage: `implement` (qa_fails re-entry)

## What was fixed

Live SDK QA failed because `@cursor/sdk` local runtime calls `getRipgrepBinaryPath()` during `.gitignore` / `.cursorignore` initialization **before** any successful `configureRipgrepPath()` call. The SDK reads an absolute `CURSOR_RIPGREP_PATH` inside `createLocalExecutor` and then calls `configureRipgrepPath()`; without that env var (and without `rg` on `PATH`), `Agent.prompt` aborts with:

```text
Ripgrep path not configured. Call configureRipgrepPath() at startup.
```

The harness now resolves the bundled `rg` binary from `@cursor/sdk-<platform>-<arch>` and sets `process.env.CURSOR_RIPGREP_PATH` **before** dynamically importing `@cursor/sdk` or invoking `Agent.prompt`.

## Approach

1. **`cursor-sdk-prereqs.ts`** (`@pancreator/runner-cursor`): resolves bundled `rg` via `createRequire`, repo-root `node_modules` walk (including pnpm hoist layout), and `process.argv[1]` ancestor walk (same strategy as the SDK’s `resolvePlatformPackageBinary`).
2. **`ensureCursorSdkRipgrepConfigured(repoRoot?)`**: sets absolute `CURSOR_RIPGREP_PATH` when resolution succeeds.
3. **`sdk-transport.ts`**: calls `ensureCursorSdkRipgrepConfigured(cwd)` before `import("@cursor/sdk")`; returns a clear transport error when the platform package is missing.
4. **`repo-env.ts`**: exports `configureCursorSdkTransportPrereqs(repoRoot)` for CLI init; **`feature-delivery-runner.ts`** invokes it when creating a live SDK runner (skipped when `mockSdkTransport` is injected).
5. **`runner-cursor/package.json`**: declares `@cursor/sdk-*` platform packages as `optionalDependencies` (version `1.0.13`, aligned with `@cursor/sdk`) so `pnpm install` reliably materializes bundled `rg` for the host OS/arch.

`configureRipgrepPath` remains internal to `@cursor/sdk`; the supported integration surface is **`CURSOR_RIPGREP_PATH`** (absolute path), which the SDK already honors at local-executor startup.

## Files changed

| Path | Change |
|------|--------|
| `src/internal/packages/@pancreator/runner-cursor/src/cursor-sdk-prereqs.ts` | **New** — resolve bundled `rg`, set `CURSOR_RIPGREP_PATH` |
| `src/internal/packages/@pancreator/runner-cursor/src/cursor-sdk-prereqs.test.ts` | **New** — unit tests for resolution |
| `src/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts` | Prereq call before SDK import; fail-fast error |
| `src/internal/packages/@pancreator/runner-cursor/src/index.ts` | Export prereq helpers |
| `src/internal/packages/@pancreator/runner-cursor/package.json` | Optional platform binary deps |
| `src/internal/packages/@pancreator/cli/src/repo-env.ts` | `configureCursorSdkTransportPrereqs` |
| `src/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts` | Invoke prereqs for live SDK runner |
| `pnpm-lock.yaml` | Lockfile update from optional deps |

## Validation commands and results

| Command | Result |
|---------|--------|
| `pnpm --filter @pancreator/cli test` | **PASS** — 50 tests |
| `pnpm --filter @pancreator/pipeline test` | **PASS** — 14 tests |
| `pnpm --filter @pancreator/runner-cursor test` | **PASS** — 6 tests |
| `node --test tests/*.test.mjs` | **100 pass / 2 fail** — failures are pre-existing repo hygiene checks on abandoned subordinate QA work dirs (`69218_0446_…`, `69601_0439_…` without `state.json`; `touch-set.json` formatting). Not introduced by this harness change. |
| `node src/internal/tools/check-phase-0a-scaffold.mjs` | **PASS** (exit 0) |
| `node src/internal/tools/context-budget-report.mjs` | **PASS** (exit 0) |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | **PASS** (exit 0) |

Manual smoke (built package):

```text
resolveCursorRipgrepBinaryPath(/Users/alen/Dev/pancreator)
→ .../node_modules/@cursor/sdk-darwin-arm64/bin/rg
ensureCursorSdkRipgrepConfigured → true
```

## How to verify SDK mode works

1. Ensure `pancreator.yaml` has `runner.cursor.invocation: sdk` and repo-root `.env` contains `CURSOR_API_KEY`.
2. Run `pnpm install` at repo root (installs `@cursor/sdk-*` optional platform binaries).
3. Run intake on the subordinate directive:

```bash
cd /Users/alen/Dev/pancreator
pnpm -w exec pan run feature-delivery 172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
```

**Expected:** `src/work/<day>/<task-id>/state.json` is written and `run.log.jsonl` contains a `cursor.runner.sdk` event (no ripgrep configuration error).

**Override:** set absolute `CURSOR_RIPGREP_PATH` in `.env` or the shell when using a custom `rg` binary.

**Operator advance:** after accepting this artifact, run:

```bash
pnpm -w exec pan advance 24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance --artifact src/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/implementation-report.md
```

## Out of scope (unchanged)

- Subordinate `client/` dashboard implementation
- `src/pipelines/feature-delivery.yaml` stage inventory
- Manual-mode default for `runner.cursor.invocation`
- Live Cursor SDK calls in default CI matrix
