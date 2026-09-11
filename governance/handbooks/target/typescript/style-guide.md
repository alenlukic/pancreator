<!-- pancreator-target-language-handbook: typescript -->

# Target TypeScript conventions

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook records conventions verified in this repository. It is not a general TypeScript manual. Where a convention below conflicts with an explicit operator directive or an invocation card, those take precedence.

## Detection evidence

`./bin/pan technologies detect --json` reported `typescript` from `tsconfig.json` and the tracked TypeScript sources under `src/` and `tests/`, including `src/cli.ts`, `src/runtime-maintenance-cli.ts`, the whole `src/lib/**` tree, and the suites under `tests/**`. TypeScript is the implementation language of the harness.

## Compiler contract

`tsconfig.json` is the authority. Agents MUST keep code compiling under it and MUST NOT relax a flag to make a change pass.

- `target` and `lib` are `ES2022`; `module` and `moduleResolution` are `NodeNext`; `types` is `["node"]` only.
- `strict` is on, together with `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, and `verbatimModuleSyntax`. Unused locals and parameters are compile errors, not warnings.
- `rootDir` is `.` and `outDir` is `dist`, so `src/cli.ts` compiles to `dist/src/cli.js` and tests compile to `dist/tests/`.
- `include` covers only `src/**/*.ts` and `tests/**/*.ts`; `exclude` covers `dist` and `node_modules`.

## Modules

- `package.json` declares `"type": "module"`, so every file is ESM.
- Node built-ins MUST use the `node:` prefix, as in `import path from 'node:path'`.
- Local imports MUST carry the compiled `.js` specifier, as in `import { invariant } from './errors.js'`, because `NodeNext` resolution runs against the emitted output.
- Type-only imports MUST use `import type`, because `verbatimModuleSyntax` forbids eliding a value import that carries only types.
- Modules under `src/lib/` use named exports. Agents SHOULD NOT introduce a default export there.

## Dependency boundary

`package.json` declares no `dependencies`; `devDependencies` are `@types/node`, `prettier`, and `typescript`. The runtime is deliberately dependency-free. Agents MUST NOT add a runtime dependency without an explicit operator directive.

`engines.node` is `>=22.0.0`, so agents MAY use Node 22 platform APIs directly instead of a shim.

## Errors and preconditions

`src/lib/errors.ts` is the shared failure vocabulary and SHOULD be reused rather than duplicated.

- `PanError` carries a stable `code`, optional `details`, and an `exitCode`. Thrown failures use an UPPER_SNAKE code such as `INVALID_REPOSITORY_CHECKS`, `INVALID_ARGUMENT`, or `PATH_ESCAPE`.
- `invariant(condition, message, { code })` asserts a precondition and narrows the type through `asserts condition`. Use it for contract violations instead of a bare `throw`.
- `errorMessage(error)` normalizes an unknown catch binding to a string; `isNodeError(error)` narrows to `NodeJS.ErrnoException`.

## Formatting

`prettier.config.js` is authoritative and its output MUST be treated as correct: 80-column print width, two-space indentation, no tabs, no semicolons, single quotes, `quoteProps: 'as-needed'`, `trailingComma: 'all'`, bracket spacing, always-parenthesized arrow parameters, and LF line endings.

Run `npm run lint` before completion. It runs `npm run format:check`, then `bash -n` over the scripts in `bin/`, and adds `npm run typecheck` only when `bin/build --stamp-fresh` reports a stale build stamp, because the emitting build type-checks the same program.

## Comments

Comments explain intent, a constraint, or a non-obvious trade-off. Exported and contract-bearing functions carry a short JSDoc one-liner, as in `/** True when 'candidate' is a Pancreator installation root. */`. Agents MUST NOT add comments that restate the next statement.

## Tests

- Tests use the Node built-in runner: `import test from 'node:test'` with `import assert from 'node:assert/strict'`.
- Mainline suites live in `tests/unit/`, `tests/integration/`, and `tests/regression/`, and import the implementation through its compiled specifier, as in `'../../src/lib/repository-checks.js'`. The slow installer suites live in `tests/secondary/`, which `npm test` excludes.
- Filesystem fixtures use `createTestTempDirectory('pancreator-<area>-')` from `tests/temp.ts`, which places them under `runtime/tmp/tests/` where `bin/run-tests` removes them after every run. Tests never call `tmpdir()`; `pan validate` rejects it under `tests/`. Removing a fixture with `rmSync(dir, { recursive: true, force: true })` inside `finally` is still good manners but no longer load-bearing. Shared helpers live in `tests/helpers.ts`.
- Verify with `npm test` for the default suite, `npm run test:secondary` for the installer lane, `./bin/pan tests impacted` while iterating, or the profiles in `runtime/repository-checks.json`, which is the command authority.

## Relationship to durable guidance

Durable Pancreator self-development guidance is now split by audience.

- `governance/handbooks/typescript/node.md` reaches the delivery personas through their own policy row. A workflow agent writing TypeScript reads that Node.js guidance.
- `governance/handbooks/typescript/style-guide.md` reaches only the librarian on the `standalone`/`style` row, which the `/pan-style` batch pass uses. A delivery persona no longer resolves the durable style guide.

This handbook records what the workspace itself demonstrates. Where it overlaps those durable handbooks, the durable handbooks remain authoritative and this file MUST NOT be read as loosening them.

`./bin/pan style scan|checkpoint` reports the countable judgment-level style issues of `.ts` and `.tsx` files and writes `runtime/cache/style.json`. It is a batch pass, not a gate, and `npm run lint` stays authoritative for mechanical style.

## No target-specific convention found

Bounded inspection found no target-specific convention for these areas, so agents MUST NOT invent one:

- No ESLint or other lint-rule configuration exists. `bin/lint` is formatting, type checking, and Bash syntax only.
- No import-ordering tool is configured; Prettier does not sort imports, and ordering follows the surrounding file.
- No naming, file-size, or directory-depth rule is enforced by tooling.
- No `.tsx` file exists in this repository, so no JSX or component convention is verifiable here.
