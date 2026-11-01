import assert from 'node:assert/strict'
import test from 'node:test'

import { initialPolicyReminder } from '../../src/lib/policy-delivery.js'
import type { Invocation, Policy } from '../../src/lib/types.js'

const DELEGATE = 'Agents MUST observe every async process.'
const BROWSER = 'Agents MUST open each page in an isolated context.'
const SHELL = 'Agents MUST wrap shell commands.'
const TS = 'Agents MUST keep TypeScript strict.'
const FAILURE = 'After a tool failure, agents MUST read the error.'

function policies(withLoad: boolean): Policy[] {
  const load = (value: string): { load?: never } | { load: never } =>
    (withLoad ? { load: value } : {}) as { load: never }

  return [
    {
      id: 'DELEGATE-001',
      title: 'Delegation',
      severity: 'hard',
      summary: 'Observe workers.',
      instructions: [{ text: DELEGATE, audience: ['agent'] }],
    },
    {
      id: 'BROWSER-001',
      title: 'Browser',
      severity: 'hard',
      summary: 'Isolated browser.',
      instructions: [
        { text: BROWSER, audience: ['agent'], ...load('tool:browser') },
        { text: SHELL, audience: ['agent'], ...load('tool:shell') },
        { text: TS, audience: ['agent'], ...load('path:**/*.ts') },
        { text: FAILURE, audience: ['agent'], ...load('event:tool_failure') },
      ],
    },
  ]
}

function invocation(withLoad: boolean): Invocation {
  return {
    schema_version: 1,
    invocation_id: 'inv-1',
    run_id: 'run-1',
    stage: { persona: 'coder', slug: 'implement' },
    output: { path: 'out.json' },
    policies: policies(withLoad),
    capabilities: { shell: true, delegation: false },
  } as unknown as Invocation
}

test('an external executor launch inlines tool and path clauses, not event clauses', () => {
  const { reminder, inlined } = initialPolicyReminder(invocation(true), 'src', {
    inlineDeferred: true,
  })

  assert.ok(reminder.content.includes(DELEGATE))
  assert.ok(reminder.content.includes(BROWSER))
  assert.ok(reminder.content.includes(SHELL))
  assert.ok(reminder.content.includes(TS))
  assert.equal(reminder.content.includes(FAILURE), false)
  assert.deepEqual(inlined.map(({ group }) => group.trigger).sort(), [
    'path:**/*.ts',
    'tool:browser',
    'tool:shell',
  ])
})

test('a hook route launch keeps the reminder to its eager clauses', () => {
  const { reminder, inlined } = initialPolicyReminder(invocation(true), 'src')

  assert.ok(reminder.content.includes(DELEGATE))
  assert.equal(reminder.content.includes(BROWSER), false)
  assert.deepEqual(inlined, [])
})

test('without load declarations the launch bytes are identical either way', () => {
  const plain = initialPolicyReminder(invocation(false), 'src')
  const external = initialPolicyReminder(invocation(false), 'src', {
    inlineDeferred: true,
  })

  assert.equal(plain.reminder.content, external.reminder.content)
  assert.equal(plain.reminder.sha256, external.reminder.sha256)
})
