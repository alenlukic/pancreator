import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  hasClauseReceipt,
  parseClauseCapabilities,
  readClauseReceipts,
  recordClauseReceipt,
  resolveDeferredClause,
  clauseReceiptPath,
} from '../../src/lib/policy-clause.js'

const GROUP = {
  policy_id: 'BROWSER-001',
  trigger: 'tool:browser' as const,
  sha256: 'a'.repeat(64),
}

function withTempRoot(run: (root: string) => void): void {
  const root = createTestTempDirectory('pan-clause-')

  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a receipt lands in the invocation ledger and reads back', () => {
  withTempRoot((root) => {
    const receipt = recordClauseReceipt(
      root,
      'inv-1',
      GROUP,
      'pull',
      new Date('2026-11-01T00:00:00.000Z'),
    )

    assert.equal(receipt.scope, 'inv-1')
    assert.equal(receipt.route, 'pull')
    assert.equal(receipt.delivered_at, '2026-11-01T00:00:00.000Z')
    assert.ok(clauseReceiptPath(root, 'inv-1').endsWith('inv-1.jsonl'))

    const receipts = readClauseReceipts(root, 'inv-1')

    assert.deepEqual(receipts, [receipt])
    assert.equal(
      hasClauseReceipt(receipts, 'BROWSER-001', 'tool:browser'),
      true,
    )
    assert.equal(hasClauseReceipt(receipts, 'BROWSER-001', 'tool:shell'), false)
  })
})

test('receipts without a scope use the session ledger and stay apart from invocations', () => {
  withTempRoot((root) => {
    recordClauseReceipt(root, undefined, GROUP, 'hook')

    assert.equal(readClauseReceipts(root, undefined).length, 1)
    assert.equal(readClauseReceipts(root, 'inv-1').length, 0)
  })
})

test('a scope that could escape the ledger directory is refused', () => {
  withTempRoot((root) => {
    assert.throws(
      () => recordClauseReceipt(root, '../escape', GROUP, 'pull'),
      /plain name/u,
    )
  })
})

test('capability lists parse and unknown names are refused', () => {
  assert.deepEqual(parseClauseCapabilities(undefined), {
    shell: true,
    delegation: true,
  })
  assert.deepEqual(parseClauseCapabilities('shell'), {
    shell: true,
    delegation: false,
  })
  assert.throws(
    () => parseClauseCapabilities('shell,browser'),
    /Unknown capability/u,
  )
})

test('an unknown policy or a non-deferred trigger is refused', () => {
  withTempRoot((root) => {
    assert.throws(
      () =>
        resolveDeferredClause(root, {
          policyId: 'NOPE-001',
          trigger: 'tool:browser',
        }),
      /Unknown policy|ENOENT|no such file/iu,
    )
  })
  assert.throws(
    () =>
      resolveDeferredClause(process.cwd(), {
        policyId: 'BROWSER-001',
        trigger: 'invocation',
      }),
    /MUST be tool/u,
  )
})
