# Implementation report — m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo

- Task id: `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- Feature id: `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- Stage: `implement` (must_fix re-entry)
- Date: 2026-05-26 (re-validated with `CURSOR_API_KEY` in repo-root `.env`)

## Summary

Must_fix re-entry closed four blocking review gaps: live Cursor SDK transport behind `runner.cursor.invocation: sdk`, LangGraph `StateGraph` compile/execute in `@pancreator/pipeline`, canonical inbox path normalization for `pan run feature-delivery`, and repository JSON formatting for touched manifests. WP-A, WP-D, WP-E, and WP-F behavior from the prior implement pass remain in place.

## Must_fix resolutions

| Item | Resolution |
|---|---|
| **WP-B — SDK stub** | `CursorRunner` calls injectable `CursorSdkTransport` (default: `@cursor/sdk` `Agent.prompt` with persona model/tools/disallowedTools/maxTurns encoded in the prompt and `resolved` envelope). Tests use a mock transport; no `sdkResult.status: "stub"`. |
| **WP-C — StateGraph** | `compilePipeline` returns a LangGraph `StateGraph` with per-stage nodes, conditional routing, and `__intervention__` side-channel node. `executePipeline` invokes `compiled.graph.compile().invoke()` with `configurable.stepFn` (no direct `definition.stages` walk). |
| **Inbox path double-prefix** | `assertInboxInRelativePath` strips a leading `lib/inbox/in/` so both bucket-relative and full inbox paths resolve. CLI test added. |
| **JSON formatting suite** | Canonical two-space formatting applied to `touch-set.json`, `@pancreator/pipeline/package.json`, `@pancreator/checkpointer-fs/package.json`, and `@pancreator/runner-cursor/package.json`. `tests/repo-structure.test.mjs` deferral matrix no longer expects `pan init` to exit `125` (WP-F implements init). |

## Work packages (unchanged from prior pass)

### WP-A — LangGraph BaseCheckpointSaver conformance

- `FsLangGraphCheckpointSaver` + envelope metadata; intervention uses checkpoint port (no parallel persistence).

### WP-B — SDK runner invocation

- `manual` default (dry-run, no SDK). `sdk` invokes transport; `readCursorInvocationMode` reads `pancreator.yaml`.
- **Live SDK (local):** With `CURSOR_API_KEY` in repo-root `.env`, default `CursorSdkTransport` (`Agent.prompt`, `composer-2.5`, local `cwd`) returned `sdkResult.status: ok` and `SDK_SMOKE_OK` in ~3s (2026-05-26). SDK emitted non-fatal ripgrep configuration warnings on startup; transport still completed.

### WP-C — Pipeline StateGraph compiler

- YAML → `StateGraph`; gate/loop/circuit_breaker metadata on compiled edges; MVP pipelines pass structural tests.

### WP-D — Phoenix conformance (Option A)

- `tests/run-logger-conformance/` + CI workflow; local smoke passes.

### WP-E — Library-mode script

- `examples/library-script/` proof for PRD US-8.

### WP-F — Install paths

- `pan init` (dry-run/apply/force) and `create-pancreator`; non-deferred CLI behavior.

## Validation results

Re-run 2026-05-26 with repo-root `.env` loaded (`CURSOR_API_KEY` present; key not committed — `.env` is gitignored).

| Command | Exit | Result | Notes |
|---|---:|---|---|
| **Live SDK smoke** (`CursorRunner` + default transport, `.env` loaded) | 0 | pass | `sdkResult.status: ok`; response contained `SDK_SMOKE_OK`; ~2965 ms |
| `pnpm --filter @pancreator/checkpointer-fs test` | 0 | pass | 7 tests |
| `pnpm --filter @pancreator/runner-cursor test` | 0 | pass | 4 tests |
| `pnpm --filter @pancreator/intervention test` | 0 | pass | 15 tests |
| `pnpm --filter @pancreator/pipeline test` | 0 | pass | 11 tests |
| `pnpm --filter @pancreator/cli test` | 0 | pass | 28 tests |
| `pnpm -w exec pan run feature-delivery lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md` | 0 | pass | Full inbox path accepted after strip/join fix |
| `pnpm --filter @pancreator/run-logger test` | 0 | pass | 6 tests |
| `pnpm test:run-logger-conformance` | 0 | pass | Phoenix boot + 3 smoke subtests |
| `pnpm --filter @pancreator/persona test` | 0 | pass | 5 tests |
| `node --test tests/*.test.mjs` | 0 | pass | 100 tests (includes repo JSON formatting) |
| `node lib/internal/tools/check-phase-0a-scaffold.mjs` | 0 | pass | |
| `node lib/internal/tools/context-budget-report.mjs` | 0 | pass | |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | 0 | pass | |
| `pnpm -w exec pan status 966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` | 0 | pass | `currentStage`: `implement` |
| `node lib/internal/tools/run-compliance.mjs` | 0 | pass | `review_passes: true`, `blockFindings: 0` |

**Build note:** Run `pnpm --filter @pancreator/{pipeline,runner-cursor,checkpointer-fs,cli} build` before `pnpm -w exec pan …` or live SDK smoke if workspace `dist/` artifacts are stale.

### Live SDK smoke (operator replay)

Load `.env`, then invoke default transport (does not print the API key):

```sh
cd /Users/alen/Dev/pancreator
pnpm --filter @pancreator/runner-cursor build
set -a && [ -f .env ] && . ./.env && set +a
node --input-type=module -e "
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env','utf8').split('\\n')) {
  const t=line.trim(); if (!t||t.startsWith('#')) continue;
  const i=t.indexOf('='); if (i<0) continue;
  const k=t.slice(0,i).trim(); let v=t.slice(i+1).trim();
  if (!process.env[k]) process.env[k]=v.replace(/^['\"]|['\"]$/g,'');
}
const { CursorRunner } = await import('./lib/internal/packages/@pancreator/runner-cursor/dist/index.js');
const persona = { name:'sdk-smoke', description:'smoke', model:'composer-2.5', permissionMode:'default', tools:['Read'], disallowedTools:[], mcpServers:[], maxTurns:3, skills:[], isolation:'worktree', memory:'project', effort:'low', color:'slate', metadata:{} };
const env = await new CursorRunner({ invocation:'sdk' }).invoke({ persona, message:'Reply with exactly SDK_SMOKE_OK' });
console.log(env.sdkResult?.status, env.sdkResult?.resultText?.slice(0,40) ?? env.sdkResult?.errorMessage);
process.exit(env.sdkResult?.status==='ok'?0:1);
"
```

## Known gaps

1. **Live SDK in CI** — Unit tests mock SDK transport; CI does not load operator `.env`. Local live path is proven with `CURSOR_API_KEY` (see validation table); wire CI secret + optional smoke job separately if required.
2. **`pan run` default invocation** — Repo `pancreator.yaml` has no `runner.cursor.invocation: sdk`; `pan run feature-delivery` still uses `manual` unless that key is set. Live SDK proof uses `CursorRunner({ invocation: 'sdk' })` directly.
3. **SDK ripgrep warnings** — Local `Agent.prompt` may log “Ripgrep path not configured” during ignore-map init; smoke still completed. Configure `configureRipgrepPath()` in a follow-on if logs must be clean.
4. **Gate/loop expressions** — Compiled as metadata and unconditional pass-through nodes; expression evaluation remains a follow-on slice.
5. **Phoenix CI cold start** — Confirm path-filtered workflow on PR (image pull latency).
6. **Option B ADR** — Not authored (Option A default; no blocking evidence).

## Documentation impact

Runtime/CLI/pipeline surfaces changed; `docs/PRD.summary.md` and conformance docs were updated in the prior pass. No additional spec edits in this re-entry (implement stage).

## Next operator steps

- **What:** Review this report and the diff; when satisfied, advance the implement stage to reviewer.
- **How:**

```sh
cd /Users/alen/Dev/pancreator
pnpm -w exec pan advance 966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo --artifact work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md
```

- **What:** Read-only re-run of the full validation gate (optional).
- **How:**

```sh
cd /Users/alen/Dev/pancreator
set -a && [ -f .env ] && . ./.env && set +a
pnpm --filter @pancreator/checkpointer-fs test
pnpm --filter @pancreator/runner-cursor test
pnpm --filter @pancreator/intervention test
pnpm --filter @pancreator/pipeline test
pnpm --filter @pancreator/cli test
pnpm -w exec pan run feature-delivery lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
pnpm test:run-logger-conformance
node --test tests/*.test.mjs
# Optional: live SDK smoke — see "Live SDK smoke (operator replay)" above
```

- **When to choose:** Before human sign-off or after pulling this branch.
- **Impact:** Read-only except `pan run feature-delivery`, which creates a new active-work directory under `work/` (use a throwaway inbox entry if you want to avoid clutter).
