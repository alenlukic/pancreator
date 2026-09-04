import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// Test fixtures never touch the shared OS temp directory. They live under the
// repository's own gitignored runtime/tmp/tests, which is per-root and so
// per-worktree, and which bin/run-tests wipes for each suite run. The shared
// temp directory is unbounded, is written by every program on the host, and
// once accumulated 166,000 leaked fixtures that taxed every create and unlink
// in it. A directory the runner owns has none of those properties.
//
// bin/run-tests exports PANCREATOR_TEST_TMP as a per-run directory that it
// removes when the run ends, and sweeps directories left by runs that died.
// A test file executed outside that wrapper falls back to a per-process
// directory in the same place, which this module removes on exit.
const REPO_ROOT = process.cwd()
const TESTS_TMP_ROOT = path.join(REPO_ROOT, 'runtime', 'tmp', 'tests')

let processParent: string | null = null

function parentDirectory(): string {
  const fromRunner = process.env.PANCREATOR_TEST_TMP

  if (fromRunner && fromRunner.length > 0) {
    return fromRunner
  }

  if (!processParent) {
    mkdirSync(TESTS_TMP_ROOT, { recursive: true })

    // Ends Node's package.json walk here so a fixture's .js files keep the
    // default module type instead of inheriting this checkout's "module".
    // bin/run-tests writes the same file; this covers a file run without it.
    const manifest = path.join(TESTS_TMP_ROOT, 'package.json')

    if (!existsSync(manifest)) {
      writeFileSync(manifest, '{}\n')
    }

    processParent = mkdtempSync(path.join(TESTS_TMP_ROOT, 'proc-'))

    const parent = processParent

    // The parent sits inside this checkout, which is a Git repository. Stop
    // git discovery at the parent so a fixture without its own .git reads as
    // "not a repository" rather than as this checkout. bin/run-tests sets the
    // same ceiling for its run directory; this covers a file run without it.
    const ceiling = process.env.GIT_CEILING_DIRECTORIES

    process.env.GIT_CEILING_DIRECTORIES = ceiling
      ? `${parent}:${ceiling}`
      : parent

    // rmSync is synchronous, so this completes before the process exits. A
    // process killed by a signal skips it; the next bin/run-tests sweep
    // removes what it left.
    process.once('exit', () => {
      rmSync(parent, { recursive: true, force: true })
    })
  }

  return processParent
}

/**
 * A fresh, unique directory for one fixture. This is the only sanctioned way
 * a test allocates scratch space; pan validate rejects tmpdir() under tests/.
 */
export function createTestTempDirectory(prefix: string): string {
  return mkdtempSync(path.join(parentDirectory(), prefix))
}

/** Where fixtures for this run live, for tests that assert on the location. */
export function testTempRoot(): string {
  return TESTS_TMP_ROOT
}
