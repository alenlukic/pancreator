import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildFunctionIndex,
  checkFunctionIndex,
  writeFunctionIndex,
} from '../../src/lib/function-index.js'
import { createTestTempDirectory } from '../temp.js'

function sourceTree(): string {
  const root = createTestTempDirectory('pan-function-index-')
  const write = (relative: string, content: string): void => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), content)
  }

  write(
    'src/lib/runs.ts',
    [
      "import { readFileSync } from 'node:fs'",
      '',
      '/**',
      ' * Load one run.',
      ' *',
      ' * Reads the state file and never writes.',
      ' */',
      'export function loadRun(root: string, id: string): string {',
      "  return readFileSync(`${root}/${id}`, 'utf8')",
      '}',
      '',
      'export const DEFAULT_ID = "a"',
      '',
      '/** One run record. */',
      'export interface Run {',
      '  /** Stable id. */',
      '  id: string',
      '  status: string',
      '}',
      '',
      'function hidden(): void {}',
      '',
    ].join('\n'),
  )
  write('src/lib/facade.ts', "export { loadRun } from './runs.js'\n")

  return root
}

test('the index records exported signatures and behavior, never bodies or private functions', () => {
  const root = sourceTree()
  const modules = buildFunctionIndex(root)

  assert.ok(modules)

  const runs = modules.find((module) => module.file === 'src/lib/runs.ts')

  assert.ok(runs)
  assert.deepEqual(
    runs.entries.map((entry) => [entry.name, entry.kind, entry.line]),
    [
      ['loadRun', 'function', 8],
      ['DEFAULT_ID', 'const', 12],
      ['Run', 'interface', 15],
    ],
  )

  const loadRun = runs.entries[0]

  assert.equal(
    loadRun?.signature,
    'function loadRun(root: string, id: string): string',
  )
  // The first paragraph is the behavior; later paragraphs stay in source.
  assert.equal(loadRun?.behavior, 'Load one run.')
  assert.match(runs.entries[2]?.signature ?? '', /id: string \/\/ Stable id\./u)

  const facade = modules.find((module) => module.file === 'src/lib/facade.ts')

  assert.deepEqual(facade?.entries, [])
  assert.deepEqual(facade?.reexports, ['./runs.js'])
})

test('the index check reports a stale page until the index is rewritten', () => {
  const root = sourceTree()

  assert.equal(checkFunctionIndex(root).status, 'stale')
  assert.equal(writeFunctionIndex(root).status, 'current')

  const page = path.join(root, 'docs/function-index/src/lib/runs.md')

  assert.match(readFileSync(page, 'utf8'), /### loadRun/u)

  writeFileSync(
    path.join(root, 'src/lib/runs.ts'),
    'export const renamed = 1\n',
  )

  const drifted = checkFunctionIndex(root)

  assert.equal(drifted.status, 'stale')
  assert.ok(drifted.stale.includes('docs/function-index/src/lib/runs.md'))
  assert.match(drifted.message, /pan docs index --write/u)
})
