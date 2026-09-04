import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateQuestionToolAccess } from '../../src/lib/validation.js'
import { createTestTempDirectory } from '../temp.js'

function createAgentFixture(frontmatter: string): string {
  const root = createTestTempDirectory('pan-question-tool-')
  const directory = path.join(root, 'library', 'cursor', 'agents')

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'fixture.md'),
    `---\n${frontmatter}\n---\n\nFixture agent.\n`,
  )

  return root
}

test('a disallowed question method fails with the file and identifier', () => {
  const disallowed = createAgentFixture(
    "disallowedTools: ['cursor/ask_question']",
  )
  const cased = createAgentFixture("tools: ['AskQuestion']")
  const empty = createTestTempDirectory('pan-question-tool-')

  try {
    const errors = validateQuestionToolAccess(disallowed)

    assert.equal(errors.length, 1)
    assert.match(errors[0] ?? '', /library\/cursor\/agents\/fixture\.md/u)
    assert.match(errors[0] ?? '', /cursor\/ask_question/u)

    const casedErrors = validateQuestionToolAccess(cased)

    assert.equal(casedErrors.length, 1)
    assert.match(casedErrors[0] ?? '', /library\/cursor\/agents\/fixture\.md/u)
    assert.match(casedErrors[0] ?? '', /askquestion/u)

    const missing = validateQuestionToolAccess(empty)

    assert.equal(missing.length, 1)
    assert.match(missing[0] ?? '', /library\/cursor\/agents/u)
  } finally {
    for (const root of [disallowed, cased, empty]) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
