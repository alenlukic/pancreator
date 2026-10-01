import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  parseCliArgs,
  runMarkdownValidator,
  validateChatMarkdown,
} from '../../src/lib/validators/markdown-validator.js'
import { createTestTempDirectory } from '../temp.js'

test('chat markdown validator reports malformed fences', () => {
  assert.deepEqual(validateChatMarkdown('```ts\nconst value = 1\n```\n'), [])

  const issues = validateChatMarkdown('- ```ts\nconst value = 1\n')
  const ids = issues.map((issue) => issue.id)

  assert.ok(ids.includes('fence.not_on_own_line'))
  assert.ok(ids.includes('fence.unclosed'))
  assert.ok(ids.includes('fence.unbalanced'))
})

test('flags a bare file-path reference in prose and in an inline code span, and allows fenced, linked, url, directory, glob, shell, and templated forms', () => {
  const markdown = [
    'See `src/lib/engine.ts` for details.',
    'Also check src/lib/engine.ts directly.',
    '```',
    'src/lib/engine.ts',
    '```',
    '[src/lib/engine.ts](/repo/src/lib/engine.ts)',
    'Visit https://example.com/src/lib/engine.ts for the source.',
    'Run `npm run build --silent` first.',
    'See the `src/lib/` directory.',
    'Match `src/lib/*.ts` files.',
    'Use `<repo-root>/src/lib/engine.ts` as a template.',
  ].join('\n')

  const issues = validateChatMarkdown(markdown, { repoRoot: '/repo' })
  const unlinked = issues.filter(
    (issue) => issue.id === 'file_reference.unlinked',
  )

  assert.deepEqual(
    unlinked.map((issue) => issue.line),
    [1, 2],
  )
})

test('flags a relative link target and allows an external url and a transcript citation', () => {
  const markdown = [
    '[engine](src/lib/engine.ts)',
    '[docs](https://example.com/path.md)',
    '[chat](0b5c1a2e-1234-4a11-9999-abcdef012345)',
  ].join('\n')

  const issues = validateChatMarkdown(markdown)
  const relative = issues.filter(
    (issue) => issue.id === 'file_link.relative_target',
  )

  assert.deepEqual(
    relative.map((issue) => issue.line),
    [1],
  )
})

test('flags wrong link display text for an absolute target and allows the correct repo-relative, full-path, code-wrapped, and fragment forms', () => {
  const repoRoot = '/repo'
  const markdown = [
    '[src/lib/engine.ts](/repo/src/lib/engine.ts)',
    '[wrong/path.ts](/repo/src/lib/engine.ts)',
    '[`src/lib/engine.ts`](/repo/src/lib/engine.ts)',
    '[src/lib/engine.ts](/repo/src/lib/engine.ts#L10)',
    '[/outside/tool.ts](/outside/tool.ts)',
    '[src/lib/engine.ts](/outside/tool.ts)',
  ].join('\n')

  const issues = validateChatMarkdown(markdown, { repoRoot })
  const display = issues.filter((issue) => issue.id === 'file_link.display')

  assert.deepEqual(
    display.map((issue) => issue.line),
    [2, 6],
  )
})

test('treats a Markdown image embed with an absolute local path as neither a file link nor a bare file reference', () => {
  assert.deepEqual(
    validateChatMarkdown('![shot](/Users/alen/shot.png)', {
      repoRoot: '/repo',
    }),
    [],
  )
})

test('parseCliArgs reads --repo-root and the positional input path', () => {
  assert.deepEqual(parseCliArgs(['--repo-root', '/tmp/repo', 'chat.md']), {
    repoRoot: '/tmp/repo',
    inputPath: 'chat.md',
  })
  assert.deepEqual(parseCliArgs(['chat.md']), {
    repoRoot: undefined,
    inputPath: 'chat.md',
  })
  assert.deepEqual(parseCliArgs([]), {
    repoRoot: undefined,
    inputPath: undefined,
  })
})

test('runMarkdownValidator checks against the given repo root and keeps exit codes 0 on pass and 1 on failure', () => {
  const tempDir = createTestTempDirectory('markdown-validator-cli')
  const passingFile = path.join(tempDir, 'passing.md')
  const failingFile = path.join(tempDir, 'failing.md')

  writeFileSync(passingFile, '[src/lib/engine.ts](/repo/src/lib/engine.ts)\n')
  writeFileSync(failingFile, '[wrong](/repo/src/lib/engine.ts)\n')

  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let stdout = ''
  let stderr = ''

  process.stdout.write = ((chunk: string): boolean => {
    stdout += chunk
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string): boolean => {
    stderr += chunk
    return true
  }) as typeof process.stderr.write

  let passExitCode: number
  let failExitCode: number

  try {
    passExitCode = runMarkdownValidator(passingFile, '/repo')
    failExitCode = runMarkdownValidator(failingFile, '/repo')
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  assert.equal(passExitCode, 0)
  assert.match(stdout, /passed/u)
  assert.equal(failExitCode, 1)
  assert.match(stderr, /file_link\.display/u)
})
