# Delivery Report — build-mode-inbox-scaffolding

## Summary

This feature closes the gap between Cursor Build mode and the Pancreator inbox queue.
The implement stage verified pre-existing shared intake scaffold code in
`intake-scaffold.ts` and `pan intake from-build-plan` wiring in `run.ts`, then shipped
documentation and test coverage for the remaining touch-set gaps. `OPERATION.md` now
documents the post-plan, pre-implementation `from-build-plan` workflow with copy-paste
`--title`, `--operator-prompt`, and `--plan-text` flags plus file equivalents. Vitest
adds 6 new cases for overwrite refusal, missing-workspace guard, slug validation, optional
file reads, required-flag validation, and file-backed flags. Review declares
`review_passes: true` with zero must-fix findings; QA declares `qa_passes: true` on all
touch-set gate commands.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/implementation-report.md",
  "range": [3, 6],
  "contentHash": "2ed6b7e"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/review.md",
  "range": [3, 3],
  "contentHash": "ffd1366"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/test-report.md",
  "range": [3, 3],
  "contentHash": "78043df"
}
```

## Architecture

- Pancreator centralizes UTC day-bucket, SID, HHMM, slug validation, Markdown templates,
  and inbox write logic in one shared CLI module so `pan intake new` and
  `pan intake from-build-plan` reuse the same path contract.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/plan.md",
  "range": [5, 5],
  "contentHash": "90d2a0f"
}
```

- Build-mode directives carry `source_channel: cursor-build-mode` in YAML frontmatter
  and populate Problem, Goal, Required outcomes, Acceptance criteria, Out of scope,
  Operator prompt (Build mode), and Plan snapshot sections from operator-supplied text.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/plan.md",
  "range": [5, 5],
  "contentHash": "90d2a0f"
}
```

- When an agent completes a Build-mode plan for a net-new request without a named inbox
  directive, the agent runs `pnpm -w exec pan intake from-build-plan <slug>` after plan
  completion and before the first repository edit that implements the plan.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/adr-draft.md",
  "range": [21, 21],
  "contentHash": "18a396a"
}
```

- Pancreator computes UTC day-bucket, SID, HHMM, slug validation, and write targets from
  one shared module at `intake-scaffold.ts`; both intake subcommands call that module.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/adr-draft.md",
  "range": [19, 19],
  "contentHash": "18a396a"
}
```

- Pancreator does not automatically start `pnpm -w exec pan run feature-delivery` from
  Build mode; operators still promote inbox directives into feature-delivery runs
  explicitly.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/adr-draft.md",
  "range": [25, 25],
  "contentHash": "18a396a"
}
```

## Interfaces

- `makeUtcDayBucket`, `secondsToMidnightUtc`, and `utcHhmm` compute UTC day-bucket, SID
  seconds-to-midnight, and HHMM tokens for canonical inbox leaf names.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts",
  "range": [12, 33],
  "contentHash": "1d4733c"
}
```

- `assertIntakeSlug` and `slugifyIntakeBasename` validate and normalize lowercase
  hyphenated intake slugs before write.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts",
  "range": [35, 56],
  "contentHash": "1d4733c"
}
```

- `buildDefaultIntakeMarkdown` and `buildBuildPlanIntakeMarkdown` emit operator-scaffolded
  and Build-mode directive bodies with the required frontmatter and section layout.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts",
  "range": [58, 154],
  "contentHash": "1d4733c"
}
```

- `createIntakeDirective` writes the canonical `lib/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md`
  path, refuses overwrite when the target exists, and throws when `pancreator.yaml` is
  absent.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts",
  "range": [156, 177],
  "contentHash": "1d4733c"
}
```

- `readOptionalTextFile` reads repo-relative or absolute paths for `--prompt-file` and
  `--plan-file` inputs.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts",
  "range": [179, 184],
  "contentHash": "1d4733c"
}
```

- `parseAndRun` exposes `pan intake from-build-plan <slug>` with required prompt and plan
  flags, stdout JSON envelope `"command": "intake from-build-plan"`, and shared scaffold
  routing.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/run.ts",
  "range": [768, 829],
  "contentHash": "f31b63d"
}
```

## Tradeoffs

- Unstaged worktree edits to `lib/personas/supervisor.md`, `.cursor/rules/supervisor.mdc`,
  `.gitignore`, and `lib/memory/active/current.md` sit outside `touch-set.json`; the
  operator SHOULD keep those changes out of the feature commit or ratify them separately.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/review.md",
  "range": [13, 13],
  "contentHash": "ffd1366"
}
```

- The package `test` script does not forward Vitest `-t`; touch-set gates use
  `pnpm --filter @pancreator/cli exec vitest run run.test.ts -t "from-build-plan|intake new"`
  instead of the original filtered `test` invocation.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/review.md",
  "range": [14, 14],
  "contentHash": "ffd1366"
}
```

- Full `node --test tests/*.test.mjs` fails on untracked `.vscode/settings.json` JSON
  formatting; that failure is outside this touch-set and excluded from the QA gate.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/review.md",
  "range": [15, 15],
  "contentHash": "ffd1366"
}
```

- Agents gain a mandatory CLI step between plan completion and implementation edits; this
  preserves the inbox intake boundary at the cost of one extra operator or agent action.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/adr-draft.md",
  "range": [32, 32],
  "contentHash": "18a396a"
}
```

- SDK runner and CursorRunner do not invoke `from-build-plan`; agents invoke the CLI
  manually per the `AGENTS.md` obligation rather than through automatic runtime wiring.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/adr-draft.md",
  "range": [33, 33],
  "contentHash": "18a396a"
}
```

## Usage guidelines

1. After Build-mode plan completion and before the first implementation edit, scaffold the
   inbox directive with inline prompt and plan text:

   ```bash
   pnpm -w exec pan intake from-build-plan build-mode-inbox \
     --title "Build-mode inbox scaffolding" \
     --operator-prompt "implement build-mode inbox auto-create" \
     --plan-text "## Plan\n\n1. CLI\n2. AGENTS.md"
   ```

   The passing test `writes pan intake from-build-plan with operator prompt and plan snapshot`
   asserts stdout `"status": "ok"`, `"command": "intake from-build-plan"`, and
   `source_channel: cursor-build-mode` in the written directive.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/run.test.ts",
  "range": [2220, 2248],
  "contentHash": "dd9e48d"
}
```

2. When shell-escaping is awkward, pass repo-relative file paths instead:

   ```bash
   pnpm -w exec pan intake from-build-plan file-backed-slug \
     --prompt-file build-prompt.txt \
     --plan-file build-plan.md
   ```

   The passing test `writes pan intake from-build-plan from prompt-file and plan-file`
   exercises `readOptionalTextFile` and confirms file-backed content lands in the directive
   body.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/run.test.ts",
  "range": [2251, 2274],
  "contentHash": "dd9e48d"
}
```

3. When the target inbox path already exists, `createIntakeDirective` throws with a message
   naming the conflicting path rather than overwriting the file. The passing test
   `refuses overwrite when the target inbox path already exists` locks that guard.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/intake-scaffold.test.ts",
  "range": [87, 113],
  "contentHash": "6514731"
}
```

4. Operator workflow copy-paste blocks and frontmatter semantics live in `OPERATION.md`
   § Inbox lifecycle under the Build-mode subsection.

```json
{
  "kind": "lines",
  "path": "OPERATION.md",
  "range": [21, 45],
  "contentHash": "a91d661"
}
```

## Testing

The staged diff adds 0 production lines, 6 new vitest cases across 2 test files, and 26
documentation lines under medium-risk `new_lines_only` defaults. Touch-set gates pass 8/8
`intake-scaffold` tests and 6/6 filtered intake CLI tests; scaffold and context-budget
checks exit 0. QA declares `qa_passes: true` after correcting the Vitest filter command in
`touch-set.json`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/test-report.md",
  "range": [3, 13],
  "contentHash": "78043df"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/review.md",
  "range": [29, 31],
  "contentHash": "ffd1366"
}
```
