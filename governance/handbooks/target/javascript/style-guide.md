<!-- pancreator-target-language-handbook: javascript -->

# Target JavaScript conventions

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook records conventions verified in this repository. It is not a general JavaScript manual. Where a convention below conflicts with an explicit operator directive or an invocation card, those take precedence.

## Detection evidence

`./bin/pan technologies detect --json` reported `javascript` from `package.json`, `prettier.config.js`, the eval fixture modules `evals/fixtures/toy-node/src/greet.mjs` and `evals/fixtures/toy-node/tests/greet.test.mjs`, and the four `services/spend-sync/` modules. Those files plus the extensionless `bin/install-support` are the complete JavaScript surface, so the conventions below are narrow by construction.

## Where JavaScript lives

JavaScript is a small, deliberate part of this repository. The harness and its tests are TypeScript.

- `prettier.config.js` is the only tracked `.js` file at the repository root. It declares `const config = { ... }` and ends with `export default config`, and it carries the annotation `/** @type {import('prettier').Config} */` so editors type-check the object without a build step.
- `bin/install-support` is the substantive installer JavaScript: a `#!/usr/bin/env node` ESM script with no file extension, invoked by `bin/install` and `bin/update`. Because it has no extension, the language detector does not list it and `pan style` does not scan it; it is still JavaScript and this handbook still governs it.
- `services/spend-sync/` is the deployed Vercel service behind `pan spend sync` and `pan spend report`. `api/snapshots/upload.js` and `api/snapshots/index.js` are route modules that export `POST` and `GET`; `lib/handlers.js` holds the request logic and `lib/blob-deps.js` wires it to `@vercel/blob`.
- `evals/fixtures/toy-node/` holds `src/greet.mjs` and `tests/greet.test.mjs`. That tree is a toy target repository the harness evals copy and drive. It is fixture content governed by its own `AGENTS.fixture.md`, not harness code.

Agents SHOULD keep new harness logic in TypeScript under `src/`. JavaScript is appropriate where a script MUST run before the TypeScript payload is built, which is the reason `bin/install-support` exists, and where a deployed runtime consumes the files directly, which is the reason `services/spend-sync/` exists.

## Module and runtime rules

- `package.json` declares `"type": "module"`, so JavaScript here is ESM. Agents MUST NOT introduce `require`.
- Node built-ins MUST use the `node:` prefix, as in `import path from 'node:path'` and `import { fileURLToPath } from 'node:url'`.
- Local imports MUST carry the `.js` extension, as in `import { handleUpload } from '../../lib/handlers.js'`.
- `engines.node` is `>=22.0.0` for the harness and `22.x` for the service, and top-level `await` is already used in `bin/install-support`.
- The harness itself declares no runtime dependencies, so installer-time JavaScript MUST rely on Node built-ins only. `services/spend-sync/package.json` is the one exception: it is a separately installed workspace that depends on `@vercel/blob` and dev-depends on `vercel`. Agents MUST NOT add a dependency to the root `package.json` to serve the service.

## Installer script idioms

`bin/install-support` sets the pattern for installer-time JavaScript and SHOULD be followed rather than restyled:

- Small top-level `function` declarations rather than classes or nested factories.
- `fail(message)` writes to `process.stderr` and calls `process.exit(1)`; `option(name)` and `requiredOption(name)` read `--flag value` pairs from `process.argv`.
- `readJson(filePath)` parses UTF-8 JSON; `writeJson(filePath, value)` creates the parent directory and writes `JSON.stringify(value, null, 2)` plus a trailing newline; `writeJsonAtomic(filePath, value)` writes through a temporary file and renames. Generated JSON in this repository MUST keep that two-space, newline-terminated shape.
- Module-level constants are UPPER_SNAKE, as in `EMBEDDED_HARNESS_PREFIX`, `UNRESOLVED_PROJECTION_TOKEN`, `LANGUAGE_BUNDLE_MARKER`, `LANGUAGE_POLICY_ID`, and `LANGUAGE_STYLE_POLICY_ID`.
- The file ends with an `if` / `else if` dispatch on `process.argv[2]` that calls one named subcommand function and fails on an unknown command. A new installer step is added as one named function plus one dispatch branch, as `strip-harness-test-scripts` is.

Some installer functions deliberately mirror compiled TypeScript, because the installer runs before the staged payload is built. Those mirrors carry a comment naming the compiled module and the tests that pin both sides. An agent changing one side MUST change the other and MUST keep that comment accurate. `governance/registries/context_bloat_dispositions.json` records that mirroring as reviewed, intentional duplication.

`preserveLanguageGovernance` is the current example: it carries its own copy of the generated language-bundle contract, including the split between the generated toolchain policy and the generated style policy, and must stay consistent with `src/lib/validators/target-language-handbooks.ts`.

## Service idioms

`services/spend-sync/` is small and SHOULD stay that way:

- A route module holds no logic. It imports the vendor module, builds its dependencies, and returns one call, as `POST(request)` in `api/snapshots/upload.js` does.
- Request logic takes injected dependencies rather than importing the vendor module, so a unit test exercises the wiring without `@vercel/blob` installed. `createBlobDeps(blob, env)` is the one seam.
- Module-level constants are UPPER_SNAKE with their units in the name, as in `SIGNED_URL_TTL_MS` and `MAX_SNAPSHOT_BYTES`.
- Exported functions carry a JSDoc block that names the route or the returned shape. A non-obvious decision carries a one-line comment, as the CDN-cache note on `presignGet` does.
- The service never proxies snapshot bytes. It returns short-lived Signed URLs the CLI transfers through. Agents MUST keep that boundary.

## Formatting

`prettier.config.js` governs JavaScript as well: 80-column print width, two-space indentation, no semicolons, single quotes, `trailingComma: 'all'`, bracket spacing, always-parenthesized arrow parameters, and LF line endings. `npm run format` and `npm run format:check` cover `services` among their explicit top-level paths. Run `npm run format:check` or `npm run lint` before completion and treat Prettier output as authoritative.

`./bin/pan style scan|checkpoint` also covers `.js`, `.cjs`, `.mjs`, and `.jsx` paths for judgment-level issues. It is a batch pass, not a gate.

## Type checking gap

`tsconfig.json` includes only `src/**/*.ts` and `tests/**/*.ts`. JavaScript is therefore **not** covered by `npm run typecheck`, and neither `bin/install-support` nor `services/spend-sync/` reaches it. Correctness rests on review and on tests written in TypeScript: the installer suites under `tests/secondary/` pin the installer behavior, `tests/integration/install-language-bundle.test.ts` pins the language-bundle preservation, and `tests/unit/spend-sync-service.test.ts` pins the service handlers. Agents changing either surface MUST run those suites through `npm run test:secondary` or the profiles in `runtime/repository-checks.json`, which is the command authority.

## No target-specific convention found

Bounded inspection found no target-specific convention for these areas, so agents MUST NOT invent one:

- No JavaScript test file exists. Every test is TypeScript, and `evals/fixtures/toy-node/tests/greet.test.mjs` follows the fixture's own minimal `node:test` shape rather than a repository-wide JavaScript test convention.
- No ESLint or other JavaScript lint-rule configuration exists.
- No JSDoc coverage requirement applies beyond the single editor-typing annotation in `prettier.config.js` and the descriptive blocks in `services/spend-sync/`.
- No `.jsx` file exists, and no convention exists for browser or bundled JavaScript, because this repository ships none.
