import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateQuestionToolAccess } from '../../src/lib/validation.js'

function createAgentFixture(frontmatter: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-question-tool-'))
  const directory = path.join(root, 'library', 'cursor', 'agents')

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'fixture.md'),
    `---\n${frontmatter}\n---\n\nFixture agent.\n`,
  )

  return root
}

test('canonical agents do not name the question method', () => {
  assert.deepEqual(validateQuestionToolAccess(process.cwd()), [])
})

test('a disallowed question method fails with the file and identifier', () => {
  const root = createAgentFixture("disallowedTools: ['cursor/ask_question']")

  try {
    const errors = validateQuestionToolAccess(root)

    assert.equal(errors.length, 1)
    assert.match(errors[0] ?? '', /library\/cursor\/agents\/fixture\.md/u)
    assert.match(errors[0] ?? '', /cursor\/ask_question/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tools declaration fails with case-insensitive matching', () => {
  const root = createAgentFixture("tools: ['AskQuestion']")

  try {
    const errors = validateQuestionToolAccess(root)

    assert.equal(errors.length, 1)
    assert.match(errors[0] ?? '', /library\/cursor\/agents\/fixture\.md/u)
    assert.match(errors[0] ?? '', /askquestion/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing canonical agent directory fails loudly', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-question-tool-'))

  try {
    assert.deepEqual(validateQuestionToolAccess(root), [
      'missing canonical Cursor agent directory: library/cursor/agents',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
