<!-- pancreator-target-language-handbook: javascript -->

# Target JavaScript conventions

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook records conventions verified in this repository. It is not a general JavaScript manual. Where a convention below conflicts with an explicit operator directive or an invocation card, those take precedence.

## Detection evidence

The technology detector reported `javascript` from `package.json` and `prettier.config.js`.

## Where JavaScript lives

JavaScript is a small, deliberate part of this repository. The application and its tests are TypeScript.

- `prettier.config.js` is the only tracked `.js` file. It uses ESM `export default` and carries the annotation `/** @type {import('prettier').Config} */` so editors type-check the object without a build step.
- `bin/install-support` is the substantive JavaScript: a `#!/usr/bin/env node` ESM script with no file extension, invoked by `bin/install` and `bin/update`.

Agents SHOULD keep new logic in TypeScript under `src/`. JavaScript is appropriate only where a script MUST run before the TypeScript payload is built, which is the reason `bin/install-support` exists at all.

## Module and runtime rules

- `package.json` declares `"type": "module"`, so JavaScript here is ESM. Agents MUST NOT introduce `require`.
- Node built-ins MUST use the `node:` prefix, as in `import path from 'node:path'` and `import { fileURLToPath } from 'node:url'`.
- `engines.node` is `>=22.0.0`, and top-level `await` is already used in `bin/install-support`.
- There are no runtime dependencies. Installer-time JavaScript MUST rely on Node built-ins only.

## Installer script idioms

`bin/install-support` sets the pattern for installer-time JavaScript and SHOULD be followed rather than restyled:

- Small top-level `function` declarations rather than classes or nested factories.
- `fail(message)` writes to `process.stderr` and calls `process.exit(1)`; `option(name)` and `requiredOption(name)` read `--flag value` pairs from `process.argv`.
- `readJson(filePath)` parses UTF-8 JSON; `writeJson(filePath, value)` creates the parent directory and writes `JSON.stringify(value, null, 2)` plus a trailing newline. Generated JSON in this repository MUST keep that two-space, newline-terminated shape.
- Module-level constants are UPPER_SNAKE, as in `EMBEDDED_HARNESS_PREFIX` and `LANGUAGE_BUNDLE_MARKER`.
- The file ends with an `if` / `else if` dispatch on `process.argv[2]` that calls one named subcommand function and fails on an unknown command.

Some installer functions deliberately mirror compiled TypeScript, because the installer runs before the staged payload is built. Those mirrors carry a comment naming the compiled module and the tests that pin both sides. An agent changing one side MUST change the other and MUST keep that comment accurate.

## Formatting

`prettier.config.js` governs JavaScript as well: 80-column print width, two-space indentation, no semicolons, single quotes, `trailingComma: 'all'`, bracket spacing, always-parenthesized arrow parameters, and LF line endings. Run `npm run format:check` or `npm run lint` before completion and treat Prettier output as authoritative.

## Type checking gap

`tsconfig.json` includes only `src/**/*.ts` and `tests/**/*.ts`. JavaScript is therefore **not** covered by `npm run typecheck`. Correctness for `bin/install-support` rests on review and on its tests: `tests/integration/embedded-installation.test.ts` pins the installer behavior and `tests/unit/projection.test.ts` pins the compiled counterpart. Agents changing installer JavaScript MUST run those suites, through `npm run test:integration` or the `runtime/repository-checks.json` profiles, which are the command authority.

## No target-specific convention found

Bounded inspection found no target-specific convention for these areas, so agents MUST NOT invent one:

- No JavaScript test files exist; every test is TypeScript. There is no convention for authoring a `.js` test.
- No ESLint or other JavaScript lint-rule configuration exists.
- No JSDoc coverage requirement applies beyond the single editor-typing annotation in `prettier.config.js`.
- No convention exists for browser or bundled JavaScript, because this repository ships none.
