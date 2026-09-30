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

test('no source or test file exceeds the line limit', () => {
  const counts = new Map(
    [...typeScriptFiles('src'), ...typeScriptFiles('tests')].map((file) => [
      file,
      lineCount(file),
    ]),
  )
  const oversized = [...counts]
    .filter(([, lines]) => lines > MAX_LINES)
    .map(([file, lines]) => `${file} (${lines} lines)`)

  assert.deepEqual(oversized, [], `Split these files below ${MAX_LINES} lines.`)
})
