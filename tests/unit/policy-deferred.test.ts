import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deferredClauseCommand,
  deferredClauseDigest,
  deferredClauseGroups,
  renderDeferredIndex,
} from '../../src/lib/policy-deferred.js'
import { renderPolicyBlocks } from '../../src/lib/policy-guidance.js'
import type { Policy } from '../../src/lib/types.js'

const EAGER = 'Agents MUST keep the summary of this policy in mind.'
const BROWSER_A =
  'Agents MUST open each page in an isolated context. Close it after use.'
const BROWSER_B = 'Agents MUST close every page they open.'
const STALL = 'On a stall, agents MUST report the cause. Then they recover.'

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'BROWSER-001',
    title: 'Shared browser inspection',
    severity: 'hard',
    summary: 'Browser inspection stays isolated.',
    instructions: [
      { text: EAGER, audience: ['agent'] },
      { text: BROWSER_A, audience: ['agent'], load: 'tool:browser' },
      { text: BROWSER_B, audience: ['agent'], load: 'tool:browser' },
      { text: STALL, audience: ['agent'], load: 'event:stall' },
    ],
    ...overrides,
  }
}

test('a card without a load field renders exactly as before', () => {
  const plain = policy({
    instructions: [
      { text: EAGER, audience: ['agent'] },
      { text: BROWSER_B, audience: ['agent'] },
    ],
  })
  const lines = renderPolicyBlocks([plain], 3, 'agent')

  assert.equal(
    lines.join('\n'),
    [
      '**BROWSER-001 · Shared browser inspection**',
      '',
      'Browser inspection stays isolated.',
      '',
      `- ${EAGER}`,
      `- ${BROWSER_B}`,
      '',
    ].join('\n'),
  )
  assert.equal(lines.join('\n').includes('Deferred policy index'), false)
})

test('a card renders the eager core and indexes each deferred trigger group', () => {
  const card = renderPolicyBlocks([policy()], 3, 'agent').join('\n')

  assert.ok(card.includes(`- ${EAGER}`))
  assert.equal(card.includes(BROWSER_A), false)
  assert.equal(card.includes(BROWSER_B), false)
  assert.equal(card.includes(STALL), false)
  // The policy heading and summary stay so a reader knows the policy applies.
  assert.ok(card.includes('**BROWSER-001 · Shared browser inspection**'))
  assert.ok(card.includes('Browser inspection stays isolated.'))
  assert.ok(card.includes('### Deferred policy index'))

  const browserDigest = deferredClauseDigest([BROWSER_A, BROWSER_B])
  const stallDigest = deferredClauseDigest([STALL])

  assert.ok(
    card.includes(
      '- `BROWSER-001` · `tool:browser` · Agents MUST open each page in an ' +
        'isolated context. · ' +
        `digest \`sha256:${browserDigest}\` · ` +
        '`./bin/pan governance clause --policy BROWSER-001 --trigger tool:browser`',
    ),
  )
  assert.ok(
    card.includes(
      `digest \`sha256:${stallDigest}\` · ` +
        '`./bin/pan governance clause --policy BROWSER-001 --trigger event:stall`',
    ),
  )
})

test('a policy whose clauses are all deferred keeps its summary and index', () => {
  const card = renderPolicyBlocks(
    [
      policy({
        instructions: [
          { text: BROWSER_A, audience: ['agent'], load: 'tool:browser' },
        ],
      }),
    ],
    3,
    'agent',
  ).join('\n')

  assert.ok(card.includes('Browser inspection stays isolated.'))
  assert.equal(card.includes(BROWSER_A), false)
  assert.ok(card.includes('`tool:browser`'))
})

test('the index advertises only clauses that apply to the card', () => {
  const gated = policy({
    instructions: [
      { text: EAGER, audience: ['agent'] },
      {
        text: BROWSER_A,
        audience: ['agent'],
        capabilities: { delegation: true },
        load: 'tool:delegation',
      },
      {
        text: STALL,
        audience: ['supervisor'],
        load: 'event:stall',
      },
    ],
  })

  assert.deepEqual(
    deferredClauseGroups(gated, 'agent', {
      shell: true,
      delegation: false,
    }),
    [],
  )
  assert.deepEqual(
    deferredClauseGroups(gated, 'agent', {
      shell: true,
      delegation: true,
    }).map((group) => group.trigger),
    ['tool:delegation'],
  )
  assert.deepEqual(
    // A supervisor card carries agent clauses plus supervisor clauses.
    deferredClauseGroups(gated, 'supervisor').map((group) => group.trigger),
    ['tool:delegation', 'event:stall'],
  )
})

test('the index digest and command are stable and per trigger', () => {
  const groups = deferredClauseGroups(policy(), 'agent')

  assert.deepEqual(
    groups.map((group) => group.trigger),
    ['tool:browser', 'event:stall'],
  )
  assert.equal(groups[0].sha256, deferredClauseDigest([BROWSER_A, BROWSER_B]))
  assert.equal(
    deferredClauseCommand('BROWSER-001', 'tool:browser', '.pancreator/bin/pan'),
    '.pancreator/bin/pan governance clause --policy BROWSER-001 --trigger tool:browser',
  )
  assert.deepEqual(renderDeferredIndex([], 3), [])
})
