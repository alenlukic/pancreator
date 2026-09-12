import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  delegateInvocation,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { ExternalDelegationRecord } from '../../src/lib/types.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { createFixture, createRun } from '../helpers.js'
import {
  CLAUDE_CODE_SPEC,
  checkpoint,
  claudeStubPath,
  installClaudeCodeFixture,
  withStub,
} from './delivery-helpers.js'

function readExecutionRecord(
  root: string,
  runId: string,
  invocationId: string,
): ExternalDelegationRecord {
  return JSON.parse(
    readFileSync(
      resolveRunLayout(root, runId).invocation(
        invocationId,
        '.delegation-execution.json',
      ).absolute,
      'utf8',
    ),
  ) as ExternalDelegationRecord
}

test('run creation fails closed when the executor binary is missing', () => {
  const root = createFixture()

  installClaudeCodeFixture(root, ['coder'])

  withStub(path.join(root, 'no-such-binary.cjs'), null, () => {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
        }),
      /Executor preflight failed/u,
    )
  })
})

test('an unauthenticated executor pauses delegation with an operator decision', () => {
  const { root, runId, invocation } = checkpoint(
    'planning[claude-code:planner]@plan-prepared',
  )

  assert.ok(invocation)

  withStub(claudeStubPath(root), 'auth-failure', () => {
    const delegated = delegateInvocation(root, runId)

    assert.equal(delegated.execution, null)
    assert.equal(delegated.state.status, 'paused')
    assert.equal(delegated.state.pending_action.type, 'operator_decision')
    assert.match(delegated.state.pause_reason ?? '', /preflight failed/u)
    assert.match(delegated.state.pause_reason ?? '', /falsify/u)
  })
})

test('executor process failures are audited and surface as errors', () => {
  const { root, runId, invocation } = checkpoint(
    'planning[claude-code:planner]@plan-prepared',
  )
  const stubPath = claudeStubPath(root)

  assert.ok(invocation)

  withStub(stubPath, null, () => {
    const invocationId = invocation.invocation_id

    // Nonzero exit throws, records the audit, and leaves the run delegatable.
    withStub(stubPath, 'nonzero', () => {
      assert.throws(
        () => delegateInvocation(root, runId),
        /External delegation failed/u,
      )
    })

    const failedRecord = readExecutionRecord(root, runId, invocationId)

    assert.equal(failedRecord.exit_code, 3)
    assert.equal(failedRecord.delegation_kind, 'fresh')
    assert.equal(
      getRunState(root, runId).pending_action.type,
      'invoke_agent',
      'a failed delegation must stay retryable',
    )

    // Malformed JSON output is also a failure, not a silent success.
    withStub(stubPath, 'malformed', () => {
      assert.throws(
        () => delegateInvocation(root, runId),
        /did not contain the expected JSON result/u,
      )
    })

    // A later healthy delegation succeeds without re-preparing.
    const recovered = delegateInvocation(root, runId)

    assert.equal(recovered.execution?.delegation_kind, 'fresh')
  })
})

test('moving a persona cursor→claude-code→cursor leaves .cursor clean', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'pan-planner.md')
  const before = readFileSync(agentPath, 'utf8')
  const configPath = path.join(root, 'config.json')
  const original = readFileSync(configPath, 'utf8')
  const config = JSON.parse(original) as {
    defaults: Record<string, string>
    configs?: Record<string, Record<string, unknown>>
  }

  // A named entry under `configs` overrides `defaults`, so the persona is
  // cleared there too.
  config.defaults.planner = CLAUDE_CODE_SPEC

  for (const named of Object.values(config.configs ?? {})) {
    delete named.planner

    if (typeof named.personas === 'object' && named.personas !== null) {
      delete (named.personas as Record<string, unknown>).planner
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const changes = syncCursorProjection(root, { write: true })
  const removal = changes.find(
    (entry) => entry.path.endsWith('pan-planner.md') && entry.removed,
  )

  assert.ok(removal, 'sync must report the stale projected agent as removed')
  assert.equal(existsSync(agentPath), false)

  // Idempotent: a second sync reports no change for the external persona.
  const again = syncCursorProjection(root, { write: true })

  assert.equal(
    again.some((entry) => entry.path.endsWith('pan-planner.md')),
    false,
  )

  // Moving back re-projects the identical file.
  writeFileSync(configPath, original)
  syncCursorProjection(root, { write: true })
  assert.equal(readFileSync(agentPath, 'utf8'), before)

  const settled = syncCursorProjection(root)

  assert.equal(
    settled.some((entry) => entry.changed),
    false,
  )
})

test('prepare skips frontmatter drift for external personas and still catches cursor drift', () => {
  const prepared = checkpoint('planning[claude-code:planner]@plan-prepared')

  assert.equal(
    existsSync(path.join(prepared.root, '.cursor', 'agents', 'pan-planner.md')),
    false,
  )
  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.persona_executor, 'claude-code')

  // A delivery run whose verifier is external still prepares its cursor
  // implement stage against the projected agent files.
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['verifier'])

  withStub(stubPath, null, () => {
    const runId = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    }).run_id
    const coderAgent = path.join(root, '.cursor', 'agents', 'pan-coder.md')
    const coderContent = readFileSync(coderAgent, 'utf8')

    writeFileSync(
      coderAgent,
      coderContent.replace(/^model: .*$/mu, 'model: drifted-model'),
    )

    const drifted = prepareInvocation(root, runId)

    assert.equal(drifted.invocation?.stage.slug, 'implement')
    assert.ok(
      drifted.advisories.some((advisory) =>
        advisory.includes('Projected Cursor agent models do not match'),
      ),
      `expected a projection advisory, got ${JSON.stringify(drifted.advisories)}`,
    )

    // Restoring the projection lets the run continue.
    writeFileSync(coderAgent, coderContent)

    const implement = prepareInvocation(root, runId)

    assert.equal(implement.invocation?.stage.slug, 'implement')
    assert.equal(implement.invocation?.stage.persona_executor, undefined)
  })
})

test('the orchestrator persona rejects external executors', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['orchestrator'])

  withStub(stubPath, null, () => {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
        }),
      /orchestrator.*MUST use the cursor executor/u,
    )
  })
})
