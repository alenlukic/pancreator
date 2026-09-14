import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  executeOpenAiTool,
  OPENAI_TOOL_NAMES,
  type OpenAiToolPolicy,
} from '../../src/lib/executors/openai-tools.js'
import { createTestTempDirectory } from '../temp.js'

/**
 * The fixture places the workspace outside the harness root, which is the
 * managed-worktree layout: the model reads both roots and writes only where
 * the stage policy allows.
 */
interface Fixture {
  harnessRoot: string
  workspaceDir: string
  outsideDir: string
  sourceAllowed: OpenAiToolPolicy
  readOnly: OpenAiToolPolicy
}

function fixture(): Fixture {
  const base = createTestTempDirectory('openai-tools-')
  const harnessRoot = path.join(base, 'harness')
  const workspaceDir = path.join(base, 'worktrees', 'chunk')
  const outsideDir = path.join(base, 'outside')
  const runtimeTree = path.join(harnessRoot, 'runtime')

  mkdirSync(path.join(workspaceDir, 'src'), { recursive: true })
  mkdirSync(path.join(workspaceDir, 'node_modules', 'left-pad'), {
    recursive: true,
  })
  mkdirSync(runtimeTree, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(path.join(harnessRoot, 'AGENTS.md'), '# harness card\n')
  writeFileSync(path.join(workspaceDir, 'src', 'engine.ts'), 'const a = 1\n')
  writeFileSync(path.join(workspaceDir, 'src', 'cli.ts'), 'const needle = 2\n')
  writeFileSync(
    path.join(workspaceDir, 'node_modules', 'left-pad', 'index.js'),
    'const needle = 3\n',
  )
  writeFileSync(path.join(outsideDir, 'secrets.txt'), 'do not read me\n')

  const bounds = { maxResultBytes: 4096, shellTimeoutMs: 10_000 }

  return {
    harnessRoot,
    workspaceDir,
    outsideDir,
    sourceAllowed: {
      workspaceDir,
      readRoots: [workspaceDir, harnessRoot],
      writeRoots: [workspaceDir, runtimeTree],
      ...bounds,
    },
    readOnly: {
      workspaceDir,
      readRoots: [workspaceDir, harnessRoot],
      writeRoots: [runtimeTree],
      ...bounds,
    },
  }
}

function call(
  name: string,
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
) {
  return executeOpenAiTool(name, JSON.stringify(args), policy)
}

test('the catalog offers the seven tools the executor implements', () => {
  assert.deepEqual([...OPENAI_TOOL_NAMES].sort(), [
    'edit_file',
    'glob_files',
    'list_directory',
    'read_file',
    'run_shell',
    'search_text',
    'write_file',
  ])
})

test('the harness root is reachable when it differs from the workspace', () => {
  const { harnessRoot, sourceAllowed } = fixture()
  const read = call(
    'read_file',
    { path: path.join(harnessRoot, 'AGENTS.md') },
    sourceAllowed,
  )

  assert.equal(read.ok, true)
  assert.equal(read.output, '# harness card\n')

  // The declared stage output lives under the harness runtime tree, which a
  // stage may write from either workspace policy.
  const written = call(
    'write_file',
    {
      path: path.join(harnessRoot, 'runtime', 'out.json'),
      content: '{"ok":true}',
    },
    sourceAllowed,
  )

  assert.equal(written.ok, true)
  assert.equal(
    readFileSync(path.join(harnessRoot, 'runtime', 'out.json'), 'utf8'),
    '{"ok":true}',
  )
})

test('a path outside every authorized root is refused, not thrown', () => {
  const { outsideDir, sourceAllowed } = fixture()
  const outside = path.join(outsideDir, 'secrets.txt')
  const read = call('read_file', { path: outside }, sourceAllowed)

  assert.equal(read.ok, false)
  assert.match(read.output, /may not read/u)
  assert.ok(
    read.output.includes(sourceAllowed.readRoots[0] as string),
    'the refusal names the authorized roots',
  )

  // Traversal out of the workspace is the same refusal, not an escape.
  const traversal = call(
    'read_file',
    { path: '../../outside/secrets.txt' },
    sourceAllowed,
  )

  assert.equal(traversal.ok, false)
  assert.match(traversal.output, /may not read/u)
})

test('write authority follows the stage workspace policy', () => {
  const { workspaceDir, readOnly, sourceAllowed } = fixture()
  const target = path.join(workspaceDir, 'src', 'engine.ts')
  const before = readFileSync(target, 'utf8')
  const refused = call(
    'write_file',
    { path: target, content: 'tampered\n' },
    readOnly,
  )

  assert.equal(refused.ok, false)
  assert.match(refused.output, /may not write/u)
  assert.equal(readFileSync(target, 'utf8'), before)

  const refusedEdit = call(
    'edit_file',
    { path: target, old_string: 'const a = 1', new_string: 'const a = 2' },
    readOnly,
  )

  assert.equal(refusedEdit.ok, false)
  assert.equal(readFileSync(target, 'utf8'), before)

  const allowed = call(
    'write_file',
    { path: target, content: 'const a = 2\n' },
    sourceAllowed,
  )

  assert.equal(allowed.ok, true)
  assert.equal(readFileSync(target, 'utf8'), 'const a = 2\n')
})

test('an oversized tool result is truncated and says so', () => {
  const { workspaceDir, sourceAllowed } = fixture()
  const big = path.join(workspaceDir, 'big.txt')

  writeFileSync(big, 'x'.repeat(sourceAllowed.maxResultBytes * 2))

  const read = call('read_file', { path: big }, sourceAllowed)

  assert.equal(read.ok, true)
  assert.equal(read.truncated, true)
  assert.match(read.output, /truncated to 4096 bytes/u)
})

test('discovery tools skip dependency trees and honor their filters', () => {
  const { sourceAllowed } = fixture()
  const globbed = call('glob_files', { pattern: 'src/*.ts' }, sourceAllowed)

  assert.deepEqual(globbed.output.split('\n').sort(), [
    'src/cli.ts',
    'src/engine.ts',
  ])

  const listed = call('list_directory', { path: 'src' }, sourceAllowed)

  assert.deepEqual(listed.output.split('\n'), ['file cli.ts', 'file engine.ts'])

  // node_modules also carries `needle`, and must not appear in the results.
  const searched = call('search_text', { pattern: 'needle' }, sourceAllowed)

  assert.deepEqual(searched.output.split('\n'), [
    'src/cli.ts:1:const needle = 2',
  ])
})

test('edit_file refuses an absent or ambiguous target string', () => {
  const { workspaceDir, sourceAllowed } = fixture()
  const target = path.join(workspaceDir, 'twice.txt')

  writeFileSync(target, 'same\nsame\n')

  const absent = call(
    'edit_file',
    { path: target, old_string: 'missing', new_string: 'x' },
    sourceAllowed,
  )

  assert.equal(absent.ok, false)
  assert.match(absent.output, /no occurrence/u)

  const ambiguous = call(
    'edit_file',
    { path: target, old_string: 'same', new_string: 'x' },
    sourceAllowed,
  )

  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.output, /2 occurrences/u)
  assert.equal(readFileSync(target, 'utf8'), 'same\nsame\n')

  const replaced = call(
    'edit_file',
    {
      path: target,
      old_string: 'same',
      new_string: 'x',
      replace_all: true,
    },
    sourceAllowed,
  )

  assert.equal(replaced.ok, true)
  assert.equal(readFileSync(target, 'utf8'), 'x\nx\n')
})

test('run_shell is pinned to an authorized directory and bounded', () => {
  const { outsideDir, workspaceDir, sourceAllowed } = fixture()
  const ran = call('run_shell', { command: 'pwd && echo hi' }, sourceAllowed)

  assert.equal(ran.ok, true)
  assert.match(ran.output, /exit_code: 0/u)
  assert.match(ran.output, /hi/u)

  const refused = call(
    'run_shell',
    { command: 'ls', cwd: outsideDir },
    sourceAllowed,
  )

  assert.equal(refused.ok, false)
  assert.match(refused.output, /may not read/u)

  const timedOut = call(
    'run_shell',
    { command: 'sleep 5' },
    { ...sourceAllowed, shellTimeoutMs: 250 },
  )

  assert.equal(timedOut.ok, false)
  assert.match(timedOut.output, /timed out after 250ms/u)

  // A nonzero exit is information for the model, not a harness failure.
  const failed = call('run_shell', { command: 'exit 7' }, sourceAllowed)

  assert.equal(failed.ok, true)
  assert.match(failed.output, /exit_code: 7/u)
  assert.equal(existsSync(workspaceDir), true)
})

test('malformed tool arguments return a message the model can act on', () => {
  const { sourceAllowed } = fixture()

  assert.match(
    executeOpenAiTool('read_file', '{not json', sourceAllowed).output,
    /not valid JSON/u,
  )
  assert.match(
    executeOpenAiTool('read_file', '[]', sourceAllowed).output,
    /MUST be a JSON object/u,
  )
  assert.match(
    call('read_file', {}, sourceAllowed).output,
    /requires a string 'path'/u,
  )
  assert.match(
    executeOpenAiTool('teleport', '{}', sourceAllowed).output,
    /Unknown tool 'teleport'/u,
  )
})
