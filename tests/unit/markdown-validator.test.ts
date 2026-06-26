import assert from 'node:assert/strict'
import test from 'node:test'

import { validateChatMarkdown } from '../../src/lib/validators/markdown-validator.js'

test('chat markdown validator accepts balanced standalone fences', () => {
  assert.deepEqual(validateChatMarkdown('```ts\nconst value = 1\n```\n'), [])
})

test('chat markdown validator reports malformed fences', () => {
  const issues = validateChatMarkdown('- ```ts\nconst value = 1\n')
  const ids = issues.map((issue) => issue.id)

  assert.ok(ids.includes('fence.not_on_own_line'))
  assert.ok(ids.includes('fence.unclosed'))
  assert.ok(ids.includes('fence.unbalanced'))
})
