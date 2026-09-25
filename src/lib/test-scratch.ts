/**
 * Where one checkout's test scratch lives.
 *
 * `bin/run-tests` runs this file as a script and every test file imports it
 * through `tests/temp.ts`, so it imports no harness module: anything it
 * imported would join the import closure of every test and widen each
 * impacted selection to the whole suite.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Checkout-relative scratch root used when `config.json` declares none. */
export const DEFAULT_TEST_SCRATCH_PATH = path.join(
  'runtime',
  'tmp',
  'tests.noindex',
)

/** Later files win, matching how `config_overrides.json` merges. */
const CONFIG_FILES = ['config.json', 'config_overrides.json']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The problem with a `test_scratch` block, or null when it is absent or valid.
 * `root: null` is valid so an override can restore the default.
 */
export function testScratchDeclarationError(value: unknown): string | null {
  if (value === undefined) {
    return null
  }

  if (!isRecord(value)) {
    return 'config.json.test_scratch MUST be an object when present.'
  }

  const root = value.root

  if (
    root === undefined ||
    root === null ||
    (typeof root === 'string' && root.trim().length > 0)
  ) {
    return null
  }

  return 'config.json.test_scratch.root MUST be a non-empty path or null.'
}

function declaredScratchRoot(checkout: string): string | null {
  let declared: string | null = null

  for (const name of CONFIG_FILES) {
    const file = path.join(checkout, name)

    if (!existsSync(file)) {
      continue
    }

    const config = JSON.parse(readFileSync(file, 'utf8')) as unknown

    if (!isRecord(config) || !('test_scratch' in config)) {
      continue
    }

    const error = testScratchDeclarationError(config.test_scratch)

    if (error) {
      throw new Error(`${name}: ${error}`)
    }

    const block = config.test_scratch as Record<string, unknown>

    if ('root' in block) {
      declared = block.root as string | null
    }
  }

  return declared
}

function expandHome(value: string, home: string): string {
  if (value === '~') {
    return home
  }

  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value
}

function checkoutIdentity(checkout: string): string {
  let resolved = path.resolve(checkout)

  try {
    resolved = realpathSync(resolved)
  } catch {
    // A checkout that does not exist yet still names one stable directory.
  }

  return createHash('sha256').update(resolved).digest('hex').slice(0, 12)
}

/**
 * The scratch root for `checkout`.
 *
 * A declared `test_scratch.root` is shared by the main checkout and every
 * worktree, because a worktree carries the same `config.json`. Each checkout
 * therefore gets its own child named by its path, so worktrees never share
 * a run directory, a duration record, or a sweep. The child keeps the
 * `.noindex` suffix that keeps fixtures out of Spotlight.
 */
export function testScratchRoot(checkout: string, home = homedir()): string {
  const declared = declaredScratchRoot(checkout)

  if (declared === null) {
    return path.join(checkout, DEFAULT_TEST_SCRATCH_PATH)
  }

  const base = path.resolve(checkout, expandHome(declared.trim(), home))
  const name = path.basename(path.resolve(checkout))

  return path.join(base, `${name}-${checkoutIdentity(checkout)}.noindex`)
}

function main(): void {
  const checkout = process.argv[2]

  if (!checkout) {
    process.stderr.write('usage: test-scratch.js <checkout-root>\n')
    process.exitCode = 1
    return
  }

  try {
    process.stdout.write(testScratchRoot(checkout))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

function invokedAsScript(): boolean {
  const argvPath = process.argv[1]

  if (argvPath === undefined) {
    return false
  }

  try {
    return realpathSync(argvPath) === fileURLToPath(import.meta.url)
  } catch {
    // A worker eval sets argv[1] to a non-path token such as `[worker eval]`.
    return false
  }
}

if (invokedAsScript()) {
  main()
}
