import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  deliverDeferredClauses,
  firedContext,
  globMatcher,
  preToolDecision,
  toolClasses,
  triggerFires,
  type DeliveryScope,
  type FiredContext,
} from '../../src/lib/governance/prompt-context/deferred.js'
import {
  readClauseReceipts,
  recordClauseReceipt,
} from '../../src/lib/policy-clause.js'
import { deferredClauseGroups } from '../../src/lib/policy-deferred.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
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
  assert.deepEqual(toolClasses('AskQuestion', {}), ['question'])
  assert.deepEqual(toolClasses('cursor/ask_question', {}), ['question'])
  assert.deepEqual(toolClasses('vscode/askQuestions', {}), ['question'])
  assert.deepEqual(toolClasses('ask_user', {}), ['question'])
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

test('a resume or pause prompt fires that event from the first token', () => {
  const events = (prompt: string) =>
    firedContext('/tmp', {
      hookEvent: 'beforeSubmitPrompt',
      toolName: null,
      toolInput: {},
      prompt,
    }).events

  assert.deepEqual(events('/pan-resume run-1'), ['resume'])
  assert.deepEqual(events('./bin/pan resume run-1'), ['resume'])
  assert.deepEqual(events('/pan-pause run-1'), ['pause'])
  assert.deepEqual(events('pan pause run-1'), ['pause'])
  assert.deepEqual(events('please pause the run'), [])
  assert.deepEqual(events('/pan-paused'), [])
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

test('DELEGATE-001 delivers supervisor-only recovery clauses and rejects an agent-only receipt', () => {
  withTempRoot((root) => {
    const policy = loadPolicyCatalog(process.cwd()).get('DELEGATE-001')!
    const delivery = {
      ...DELIVERY,
      policies: [policy],
      audiences: ['agent', 'supervisor'] as const,
    }
    const scope: DeliveryScope = {
      ...delivery,
      audiences: [...delivery.audiences],
    }
    const agent = deferredClauseGroups(
      policy,
      'agent',
      scope.capabilities,
    ).find((group) => group.trigger === 'event:stall')!
    const supervisor = deferredClauseGroups(
      policy,
      'supervisor',
      scope.capabilities,
    ).find((group) => group.trigger === 'event:stall')!
    recordClauseReceipt(root, scope.scope, agent, 'pull')
    const text = deliverDeferredClauses(
      root,
      scope.scope,
      fired({ events: ['stall'] }),
      new Date(),
      scope,
    )
    assert.ok(
      text?.includes(
        'A supervisor MUST NOT interrupt a worker or a wrapped command except',
      ),
    )
    assert.equal(
      readClauseReceipts(root, scope.scope).at(-1)?.sha256,
      supervisor.sha256,
    )
    assert.equal(
      deliverDeferredClauses(
        root,
        scope.scope,
        fired({ events: ['stall'] }),
        new Date(),
        scope,
      ),
      null,
    )
  })
})

test('native shell and delegation tools deliver before first use, including headless delegation', () => {
  assert.deepEqual(toolClasses('run_in_terminal', { command: 'ls' }), ['shell'])
  assert.deepEqual(toolClasses('task', {}), ['delegation'])
  assert.deepEqual(toolClasses('runSubagent', {}), ['delegation'])
  assert.deepEqual(
    toolClasses('Shell', {
      command: 'bin/pan-run -- ./bin/pan delegate run-1 --headless',
    }),
    ['shell', 'delegation'],
  )
  withTempRoot((root) => {
    const policy = loadPolicyCatalog(process.cwd()).get('DELEGATE-001')!
    const scope: DeliveryScope = {
      ...DELIVERY,
      policies: [policy],
      capabilities: { shell: true, delegation: false },
    }
    const call = fired({ classes: ['shell'] })
    const first = preToolDecision(root, scope.scope, call, new Date(), scope)
    assert.equal(first.permission, 'deny')
    assert.match(
      first.agent_message ?? '',
      /Shell-capable workers MUST run shell commands inside/,
    )
    assert.doesNotMatch(
      first.agent_message ?? '',
      /Every agent shell command MUST/,
    )
    assert.equal(
      preToolDecision(root, scope.scope, call, new Date(), scope).permission,
      'allow',
    )
  })
})

test('watch recovery verdicts fire the recovery event without treating unrelated failures as stalls', () => {
  withTempRoot((root) => {
    const payload = {
      hookEvent: 'postToolUse',
      toolName: 'Shell',
      toolInput: { command: './bin/pan watch run-1' },
      prompt: '',
    }
    for (const output of [
      'watch stalled: invocation inv-1',
      'watch unverified: invocation inv-1',
      'watch changed: 1 of 2 targets moved; needs inspection: run-2:inv-2',
      { state: 'changed', stalled: [{ run_id: 'run-2' }] },
      'agent watch unregistered: the index never registered',
      '── Result ──\n  attach_wake · 300.0s',
      { stdout: JSON.stringify({ state: 'timed_out' }) },
    ]) {
      assert.ok(
        firedContext(root, { ...payload, toolOutput: output }).events.includes(
          'stall',
        ),
      )
    }
    assert.ok(
      !firedContext(root, {
        ...payload,
        toolOutput: 'watch completed: invocation inv-1',
      }).events.includes('stall'),
    )
    assert.ok(
      !firedContext(root, {
        ...payload,
        toolInput: { command: 'npm test' },
        toolOutput: 'watch stalled: invocation inv-1',
      }).events.includes('stall'),
    )
  })
})
