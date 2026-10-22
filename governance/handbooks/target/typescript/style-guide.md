<!-- pancreator-target-language-handbook: typescript -->

# Target TypeScript conventions

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook records conventions verified in this repository. It is not a general TypeScript manual. Where a convention below conflicts with an explicit operator directive or an invocation card, those take precedence.

## Detection evidence

`./bin/pan technologies detect --json` reported `typescript` from `tsconfig.json` and the tracked TypeScript sources: the entrypoints `src/cli.ts`, `src/openai-cli.ts`, `src/openai-agent-cli.ts`, `src/runtime-maintenance-cli.ts`, `src/vscode-customizations.ts`, and the three hook entrypoints; the `src/cli/` command modules; the whole `src/lib/**` tree; the suites under `tests/**`; and the three Cursor Canvas templates `library/templates/spend-canvas-shared.tsx`, `spend-report.canvas.tsx`, and `spend-trends.canvas.tsx`. TypeScript is the implementation language of the harness.

## Compiler contract

`tsconfig.json` is the authority. Agents MUST keep code compiling under it and MUST NOT relax a flag to make a change pass.

- `target` and `lib` are `ES2022`; `module` and `moduleResolution` are `NodeNext`; `types` is `["node"]` only.
- `strict` is on, together with `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, and `verbatimModuleSyntax`. Unused locals and parameters are compile errors, not warnings.
- `sourceMap` and `skipLibCheck` are on.
- `rootDir` is `.` and `outDir` is `dist`, so `src/cli.ts` compiles to `dist/src/cli.js` and tests compile to `dist/tests/`.
- `include` covers only `src/**/*.ts` and `tests/**/*.ts`; `exclude` covers `dist` and `node_modules`. The `.tsx` canvas templates under `library/templates/` are therefore outside the compiler: they are rendered into Cursor's managed canvas directory by `pan spend --canvas` and import only from `cursor/canvas`. Agents MUST NOT add them to `include`, and MUST NOT treat a type error reported by an editor there as a build failure.

## Modules

- `package.json` declares `"type": "module"`, so every file is ESM.
- Node built-ins MUST use the `node:` prefix, as in `import path from 'node:path'`.
- Local imports MUST carry the compiled `.js` specifier, as in `import { invariant } from './errors.js'`, because `NodeNext` resolution runs against the emitted output.
- Type-only imports MUST use `import type`, because `verbatimModuleSyntax` forbids eliding a value import that carries only types.
- Modules under `src/lib/` use named exports. Agents SHOULD NOT introduce a default export there.
- A large subsystem is a directory of focused modules beside a barrel of the same name that re-exports its public surface, as `src/lib/watch.ts` does for `src/lib/watch/` and `src/lib/engine.ts` does for `src/lib/engine/`. Agents SHOULD extend a subsystem by adding a module and re-exporting it, rather than by growing the barrel.
- `src/cli.ts` is dispatch only: one `switch` over the first argument, each arm returning one command function imported from `src/cli/`. A new command is one `src/cli/` function plus one arm plus its usage block in `src/lib/pan-command-grammar.ts`.

## Dependency boundary

The root `package.json` declares no `dependencies`; `devDependencies` are `@types/node`, `prettier`, and `typescript`. The harness runtime is deliberately dependency-free. Agents MUST NOT add a runtime dependency without an explicit operator directive. `services/spend-sync/` carries its own manifest and is the only part of the repository with a third-party dependency.

`engines.node` is `>=22.0.0`, so agents MAY use Node 22 platform APIs directly instead of a shim.

## Errors and preconditions

`src/lib/errors.ts` is the shared failure vocabulary and SHOULD be reused rather than duplicated.

- `PanError` carries a stable `code`, optional `details`, and an `exitCode`. Thrown failures use an UPPER_SNAKE code such as `INVALID_REPOSITORY_CHECKS`, `INVALID_ARGUMENT`, or `PATH_ESCAPE`.
- `invariant(condition, message, { code })` asserts a precondition and narrows the type through `asserts condition`. Use it for contract violations instead of a bare `throw`.
- `errorMessage(error)` normalizes an unknown catch binding to a string; `isNodeError(error)` narrows to `NodeJS.ErrnoException`.
- A `catch` that swallows a failure MUST be justified in a comment, because a read the code cannot perform is not an answer. `cliEntrypointMatches` in `src/cli.ts` is the worked example: it rethrows as `ENTRYPOINT_PATH_UNREADABLE` rather than report "not the entrypoint" and exit 0.

## Formatting

`prettier.config.js` is authoritative and its output MUST be treated as correct: 80-column print width, two-space indentation, no tabs, no semicolons, single quotes, `quoteProps: 'as-needed'`, `trailingComma: 'all'`, bracket spacing, always-parenthesized arrow parameters, and LF line endings.

Run `npm run lint` before completion. It runs `npm run format:check`, then adds `npm run typecheck` only when `bin/build --stamp-fresh` reports a stale build stamp (because the emitting build type-checks the same program), then `bin/check-shell`: `bash -n` under `/bin/bash` over every Bash script in `bin/` and `.githooks/`, plus `shellcheck -S error` when it is installed.

## Comments

Comments explain intent, a constraint, or a non-obvious trade-off. Exported and contract-bearing functions carry a short JSDoc one-liner, as in `/** True when 'candidate' is a Pancreator installation root. */`. A module whose behavior encodes a decision carries a block comment stating the decision and the failure it prevents. Agents MUST NOT add comments that restate the next statement.

## Tests

- Tests use the Node built-in runner: `import test from 'node:test'` with `import assert from 'node:assert/strict'`.
- Lanes are `tests/unit/`, `tests/regression/`, `tests/integration/`, and `tests/secondary/`. They import the implementation through its compiled specifier, as in `'../../src/lib/repository-checks.js'`.
- `npm test` runs the unit and regression lanes only. The integration lane runs through the `impacted-integration` profile at the implement and remediate gates and in full through `npm run test:coverage`; `tests/secondary/` holds the installer suites and runs through `npm run test:secondary`.
- Filesystem fixtures use `createTestTempDirectory('pancreator-<area>-')` from `tests/temp.ts`. Tests never call `tmpdir()`; `pan validate` rejects it under `tests/`. `bin/run-tests` owns one scratch directory per suite run and discards it afterwards, so removing a fixture in `finally` is good manners rather than load-bearing. The scratch root is `runtime/tmp/tests.noindex/` by default and moves under `config.json.test_scratch.root` when that block is declared. Shared helpers live in `tests/helpers.ts` and `tests/run-helpers.ts`; `tests/shared-template.ts` and `tests/fixture-template.ts` build and clone the per-suite-run fixture template.
- Verify with `npm test` for the default lanes, `npm run test:secondary` for the installer lane, `./bin/pan tests impacted` while iterating, or the profiles in `runtime/repository-checks.json`, which is the command authority.

## Relationship to durable guidance

Durable Pancreator self-development guidance is split by audience.

- `governance/handbooks/typescript/node.md` reaches the delivery personas through their own policy row. A workflow agent writing TypeScript reads that Node.js guidance.
- `governance/handbooks/typescript/style-guide.md` reaches only the librarian on the `standalone`/`style` row, which the `/pan-style` batch pass uses. A delivery persona no longer resolves the durable style guide.

This handbook records what the workspace itself demonstrates. Where it overlaps those durable handbooks, the durable handbooks remain authoritative and this file MUST NOT be read as loosening them.

`./bin/pan style scan|checkpoint` reports the countable judgment-level style issues of `.ts` and `.tsx` files and writes `runtime/cache/style.json`. It is a batch pass, not a gate, and `npm run lint` stays authoritative for mechanical style.

## No target-specific convention found

Bounded inspection found no target-specific convention for these areas, so agents MUST NOT invent one:

- No ESLint or other lint-rule configuration exists. `bin/lint` is formatting, type checking, and Bash checking only.
- No import-ordering tool is configured; Prettier does not sort imports, and ordering follows the surrounding file.
- No naming, file-size, or directory-depth rule is enforced by tooling.
- No JSX convention is verifiable beyond the three Cursor Canvas templates, which follow Cursor's own canvas contract rather than a repository convention, and which no build or type check covers.
