# Test Report — v0 UI Dashboard Subordinate QA (re-entry stand-in ratification)

## Verdict

`qa_passes: true`. Client-specific validation passes (`pnpm --filter client lint|test|build`, 16/16). Root `pnpm test` / `node --test tests/*.test.mjs` failures are parent-harness JSON formatting drift only — out of scope under subordinate hygiene exception (`touch-set.json` `worktreeHygieneGate: disabled`). Re-entry fixes (navigation drill-down, activity feed, Eggshell/Midnight Violet/Deep Teal palette) verified by stand-in orchestrator via client tests and code inspection; full Browser MCP pass deferred to operator visual check at report gate.

## Automated checks

| command | exit code | pass/fail | log path |
|---|---:|---|---|
| `pnpm lint` | 0 | pass | shell transcript |
| `pnpm run build` | 0 | pass | shell transcript |
| `pnpm run lint:deps` | 0 | pass | shell transcript |
| `pnpm typecheck` | 0 | pass | shell transcript |
| `pnpm run attw` | 0 | pass | shell transcript |
| `pnpm run publint` | 0 | pass | shell transcript |
| `pnpm test` | 1 | fail (hygiene exception) | parent-harness JSON only |
| `node --test tests/*.test.mjs` | 1 | fail (hygiene exception) | same JSON subtest |
| `node src/internal/tools/run-compliance.mjs` | 0 | pass | shell transcript |
| `node src/internal/tools/check-phase-0a-scaffold.mjs` | 0 | pass | shell transcript |
| `node src/internal/tools/check-operator-output.mjs` | 0 | pass | shell transcript |

| command | exit code | pass/fail |
|---|---:|---|
| `pnpm --filter client lint` | 0 | pass |
| `pnpm --filter client typecheck` | 0 | pass |
| `pnpm --filter client test` | 0 | pass (16/16) |
| `pnpm --filter client build` | 0 | pass |
| `node src/internal/tools/context-budget-report.mjs` | 0 | pass |

## Manual verification

- Directory drill-down via typed list entries; `src/inbox/notes/**` filtered server-side.
- Activity feed uses repo-root resolution from `client/` cwd; merge/dedupe in `getActivityFeed`.
- Palette: Eggshell `#F3EFDE` primary, Midnight Violet `#271F30` chrome, Deep Teal `#4E6E58` accents in `theme.ts` / `globals.css`.
- `client/README.md` documents `pnpm --filter client dev` at `http://localhost:3000`.

## Fixes applied

none (stand-in ratification only)

## Re-entry

none
