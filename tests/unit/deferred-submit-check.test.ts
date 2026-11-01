import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  assertDeferredClausesDelivered,
  DEFERRED_CLAUSE_UNDELIVERED,
} from '../../src/lib/engine/submit-checks.js'
import {
  preToolDecision,
  deliverDeferredClauses,
  type DeliveryScope,
  type FiredContext,
} from '../../src/lib/governance/prompt-context/deferred.js'
import {
  recordClauseFired,
  recordClauseReceipt,
  undeliveredClauses,
} from '../../src/lib/policy-clause.js'
import type { Invocation, Policy } from '../../src/lib/types.js'

const INVOCATION = 'inv-1'
const POLICIES: Policy[] = [
  {
    id: 'BROWSER-001',
    title: 'Shared browser inspection',
    severity: 'hard',
    summary: 'Browser inspection stays isolated.',
    instructions: [
      {
        text: 'Agents MUST open each browser page in an isolated context.',
        audience: ['agent'],
        load: 'tool:browser',
      },
      {
        text: 'Agents MUST stay headless.',
        audience: ['agent'],
        load: 'tool:shell',
      },
    ],
  },
]
const DELIVERY: DeliveryScope = {
  scope: INVOCATION,
  policies: POLICIES,
  capabilities: { shell: true, delegation: true },
  audiences: ['agent'],
}
const invocation = { invocation_id: INVOCATION } as unknown as Invocation
const fired = (overrides: Partial<FiredContext>): FiredContext => ({
  classes: [],
  events: [],
  paths: [],
  ...overrides,
})

function withTempRoot(run: (root: string) => void): void {
  const root = createTestTempDirectory('pan-submit-')

  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function refusal(run: () => void): { code?: string; message: string } {
  try {
    run()
  } catch (error) {
    return error as { code?: string; message: string }
  }

  assert.fail('Expected the check to refuse.')
}

test('submit passes when nothing fired', () => {
  withTempRoot((root) => {
    assert.doesNotThrow(() => assertDeferredClausesDelivered(root, invocation))
  })
})

test('submit refuses a fired trigger without a receipt and names the pull command', () => {
  withTempRoot((root) => {
    recordClauseFired(root, INVOCATION, {
      policy_id: 'BROWSER-001',
      trigger: 'tool:browser',
    })

    const error = refusal(() =>
      assertDeferredClausesDelivered(root, invocation),
    )

    assert.equal(error.code, DEFERRED_CLAUSE_UNDELIVERED)
    assert.match(error.message, /BROWSER-001 \(tool:browser\)/u)
    assert.match(
      error.message,
      /governance clause --policy BROWSER-001 --trigger 'tool:browser' --invocation inv-1/u,
    )
  })
})

test('a pull receipt clears the refusal', () => {
  withTempRoot((root) => {
    const group = { policy_id: 'BROWSER-001', trigger: 'tool:browser' as const }

    recordClauseFired(root, INVOCATION, group)
    recordClauseReceipt(
      root,
      INVOCATION,
      { ...group, sha256: 'sha256:x' },
      'pull',
    )

    assert.doesNotThrow(() => assertDeferredClausesDelivered(root, invocation))
  })
})

test('the pre-tool hook records a fired trigger and the hook delivery clears it', () => {
  withTempRoot((root) => {
    // shell is not a held class: the call is allowed but the trigger is recorded.
    const decision = preToolDecision(
      root,
      INVOCATION,
      fired({ classes: ['shell'] }),
      new Date(),
      DELIVERY,
    )

    assert.equal(decision.permission, 'allow')
    assert.deepEqual(
      undeliveredClauses(root, INVOCATION).map((entry) => entry.trigger),
      ['tool:shell'],
    )
    assert.equal(
      refusal(() => assertDeferredClausesDelivered(root, invocation)).code,
      DEFERRED_CLAUSE_UNDELIVERED,
    )

    // The post-tool hook delivers; the receipt closes the gap.
    assert.ok(
      deliverDeferredClauses(
        root,
        INVOCATION,
        fired({ classes: ['shell'] }),
        new Date(),
        DELIVERY,
      ),
    )
    assert.deepEqual(undeliveredClauses(root, INVOCATION), [])
    assert.doesNotThrow(() => assertDeferredClausesDelivered(root, invocation))
  })
})

test('a held class is delivered with the denial, so submit passes', () => {
  withTempRoot((root) => {
    const decision = preToolDecision(
      root,
      INVOCATION,
      fired({ classes: ['browser'] }),
      new Date(),
      DELIVERY,
    )

    assert.equal(decision.permission, 'deny')
    assert.doesNotThrow(() => assertDeferredClausesDelivered(root, invocation))
  })
})

test('firing the same trigger twice records one entry', () => {
  withTempRoot((root) => {
    const group = { policy_id: 'BROWSER-001', trigger: 'tool:browser' as const }

    assert.ok(recordClauseFired(root, INVOCATION, group))
    assert.equal(recordClauseFired(root, INVOCATION, group), null)
  })
})
