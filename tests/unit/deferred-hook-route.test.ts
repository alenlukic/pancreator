import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  deliverDeferredClauses,
  globMatcher,
  preToolDecision,
  toolClasses,
  triggerFires,
  type DeliveryScope,
  type FiredContext,
} from '../../src/lib/governance/prompt-context/deferred.js'
import { readClauseReceipts } from '../../src/lib/policy-clause.js'
import type { Policy } from '../../src/lib/types.js'

const BROWSER = 'Agents MUST open each browser page in an isolated context.'
const TS = 'Agents MUST keep TypeScript strict.'
const FAILURE = 'After a tool failure, agents MUST read the error.'

const POLICIES: Policy[] = [
  {
    id: 'BROWSER-001',
    title: 'Shared browser inspection',
    severity: 'hard',
    summary: 'Browser inspection stays isolated.',
    instructions: [
      { text: BROWSER, audience: ['agent'], load: 'tool:browser' },
    ],
  },
  {
    id: 'TS-001',
    title: 'TypeScript',
    severity: 'hard',
    summary: 'TypeScript conventions.',
    instructions: [
      { text: TS, audience: ['agent'], load: 'path:**/*.{ts,tsx}' },
    ],
  },
  {
    id: 'RECOVER-001',
    title: 'Recovery',
    severity: 'hard',
    summary: 'Recover from failure.',
    instructions: [
      { text: FAILURE, audience: ['agent'], load: 'event:tool_failure' },
    ],
  },
]

const DELIVERY: DeliveryScope = {
  scope: 'conv-1',
  policies: POLICIES,
  capabilities: { shell: true, delegation: true },
  audiences: ['agent'],
}

const fired = (overrides: Partial<FiredContext>): FiredContext => ({
  classes: [],
  events: [],
  paths: [],
  ...overrides,
})

function withTempRoot(run: (root: string) => void): void {
  const root = createTestTempDirectory('pan-hook-')

  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('globs cover recursive, single segment, and brace forms', () => {
  const matcher = globMatcher('**/*.{ts,tsx}')

  assert.equal(matcher.test('src/lib/a.ts'), true)
  assert.equal(matcher.test('a.tsx'), true)
  assert.equal(matcher.test('src/lib/a.py'), false)
  assert.equal(globMatcher('src/**').test('src/lib/a.ts'), true)
  assert.equal(globMatcher('src/*.ts').test('src/lib/a.ts'), false)
  assert.equal(globMatcher('{a,b}/x,y').test('a/x,y'), true)
  assert.equal(globMatcher('{a,b}/x,y').test('b/y'), false)
})

test('tool names map to classes and Shell commands detect remote git', () => {
  assert.deepEqual(toolClasses('Shell', { command: 'ls' }), ['shell'])
  assert.deepEqual(toolClasses('Shell', { command: 'git push origin x' }), [
    'shell',
    'git-remote',
  ])
  assert.deepEqual(toolClasses('Task', {}), ['delegation'])
  assert.deepEqual(toolClasses('StrReplace', {}), ['edit'])
  assert.deepEqual(toolClasses('new_page', {}), ['browser'])
  assert.deepEqual(toolClasses('Read', {}), [])
  assert.deepEqual(toolClasses(null, {}), [])
})

test('triggers fire only on their own class, event, or path', () => {
  assert.equal(
    triggerFires('tool:browser', fired({ classes: ['browser'] })),
    true,
  )
  assert.equal(
    triggerFires('tool:browser', fired({ classes: ['shell'] })),
    false,
  )
  assert.equal(
    triggerFires('event:tool_failure', fired({ events: ['tool_failure'] })),
    true,
  )
  assert.equal(
    triggerFires('path:**/*.ts', fired({ paths: ['src/a.ts'] })),
    true,
  )
  assert.equal(triggerFires('path:**/*.ts', fired({ paths: ['a.py'] })), false)
})

test('a clause is delivered once, with a receipt, then stays silent', () => {
  withTempRoot((root) => {
    const first = deliverDeferredClauses(
      root,
      'conv-1',
      fired({ classes: ['browser'] }),
      new Date('2026-11-01T00:00:00.000Z'),
      DELIVERY,
    )

    assert.ok(first?.includes(BROWSER))
    assert.equal(first?.includes(TS), false)
    assert.equal(
      deliverDeferredClauses(
        root,
        'conv-1',
        fired({ classes: ['browser'] }),
        new Date(),
        DELIVERY,
      ),
      null,
    )

    const receipts = readClauseReceipts(root, 'conv-1')

    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].route, 'hook')
    assert.equal(receipts[0].policy_id, 'BROWSER-001')
  })
})

test('an unrelated call delivers nothing and writes no receipt', () => {
  withTempRoot((root) => {
    assert.equal(
      deliverDeferredClauses(
        root,
        'conv-1',
        fired({ classes: ['shell'] }),
        new Date(),
        DELIVERY,
      ),
      null,
    )
    assert.deepEqual(readClauseReceipts(root, 'conv-1'), [])
  })
})

test('a failure event delivers the failure clause', () => {
  withTempRoot((root) => {
    const text = deliverDeferredClauses(
      root,
      'conv-1',
      fired({ events: ['tool_failure'] }),
      new Date(),
      DELIVERY,
    )

    assert.ok(text?.includes(FAILURE))
  })
})

test('the pre-tool hook denies a held class once, then allows the retry', () => {
  withTempRoot((root) => {
    const call = fired({ classes: ['browser'] })
    const denied = preToolDecision(root, 'conv-1', call, new Date(), DELIVERY)

    assert.equal(denied.permission, 'deny')
    assert.ok(denied.agent_message?.includes(BROWSER))
    assert.deepEqual(
      preToolDecision(root, 'conv-1', call, new Date(), DELIVERY),
      { permission: 'allow' },
    )
  })
})

test('the pre-tool hook holds an edit by path and allows classes it does not hold', () => {
  withTempRoot((root) => {
    const edit = preToolDecision(
      root,
      'conv-1',
      fired({ classes: ['edit'], paths: ['src/a.ts'] }),
      new Date(),
      DELIVERY,
    )

    assert.equal(edit.permission, 'deny')
    assert.ok(edit.agent_message?.includes(TS))
    assert.deepEqual(
      preToolDecision(
        root,
        'conv-1',
        fired({ classes: ['shell'] }),
        new Date(),
        DELIVERY,
      ),
      { permission: 'allow' },
    )
    assert.deepEqual(
      preToolDecision(
        root,
        'conv-1',
        fired({ events: ['tool_failure'] }),
        new Date(),
        DELIVERY,
      ),
      { permission: 'allow' },
    )
  })
})

test('two scopes keep separate receipts', () => {
  withTempRoot((root) => {
    const call = fired({ classes: ['browser'] })
    const other: DeliveryScope = { ...DELIVERY, scope: 'conv-2' }

    assert.ok(
      deliverDeferredClauses(root, 'conv-1', call, new Date(), DELIVERY),
    )
    assert.ok(deliverDeferredClauses(root, 'conv-2', call, new Date(), other))
  })
})
