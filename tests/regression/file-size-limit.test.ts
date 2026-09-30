import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()

/**
 * Workers read source and tests in windows, and a file too long to hold in
 * view is paged through and re-read. No TypeScript file under `src/` or
 * `tests/` may exceed this many lines.
 */
const MAX_LINES = 1000

/**
 * Files still waiting for their split. An entry leaves the list in the change
 * that splits it; a listed file that fits the limit fails this test, so the
 * list only shrinks.
 */
const PENDING_SPLIT = new Set([
  'src/cli.ts',
  'src/lib/agent-index.ts',
  'src/lib/cleanup.ts',
  'src/lib/cursor-handoff/driver.ts',
  'src/lib/git.ts',
  'src/lib/release-landing.ts',
  'src/lib/schedule.ts',
  'src/lib/worktrees.ts',
])

function typeScriptFiles(directory: string): string[] {
  return readdirSync(path.join(REPO_ROOT, directory), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) =>
      path
        .relative(REPO_ROOT, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
}

function lineCount(relative: string): number {
  const text = readFileSync(path.join(REPO_ROOT, relative), 'utf8')

  return text.endsWith('\n')
    ? text.split('\n').length - 1
    : text.split('\n').length
}

test('no source or test file exceeds the line limit unless its split is pending', () => {
  const counts = new Map(
    [...typeScriptFiles('src'), ...typeScriptFiles('tests')].map((file) => [
      file,
      lineCount(file),
    ]),
  )
  const oversized = [...counts]
    .filter(([file, lines]) => lines > MAX_LINES && !PENDING_SPLIT.has(file))
    .map(([file, lines]) => `${file} (${lines} lines)`)
  const settled = [...PENDING_SPLIT].filter(
    (file) => (counts.get(file) ?? 0) <= MAX_LINES,
  )

  assert.deepEqual(oversized, [], `Split these files below ${MAX_LINES} lines.`)
  assert.deepEqual(
    settled,
    [],
    'These files fit the limit now; remove them from PENDING_SPLIT.',
  )
})
