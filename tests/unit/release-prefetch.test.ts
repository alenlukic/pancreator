import assert from 'node:assert/strict'
import test from 'node:test'

import { pendingReleaseProfilePrefetch } from '../../src/lib/engine.js'
import type {
  RunState,
  StageDefinition,
  StageOutcome,
} from '../../src/lib/types.js'
import { resolveVerification } from '../../src/lib/verification.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'

function withEnv<Result>(
  values: Record<string, string | undefined>,
  body: () => Result,
): Result {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  )

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    return body()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('release prefetch rejects every ineligible submission state', () => {
  const root = sharedFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const implement = stageBySlug(workflow, 'implement')

  const running = {
    status: 'running',
    current_stage: 'verify',
    verification: resolveVerification(root, 'light'),
  } as RunState
  const fingerprint = 'fixture-fingerprint'
  const candidate = (
    state = running,
    stage: StageDefinition = implement,
    outcome: StageOutcome = 'success',
  ) =>
    pendingReleaseProfilePrefetch(
      root,
      state,
      workflow,
      stage,
      outcome,
      fingerprint,
    )

  withEnv({ PAN_PREFETCH_FULL: undefined, PAN_GATE_CACHE: undefined }, () => {
    assert.deepEqual(candidate(), {
      profile: 'full',
      workspace_fingerprint: fingerprint,
    })
    assert.equal(candidate(running, implement, 'failure'), null)
    assert.equal(
      candidate(running, { ...implement, workspace_policy: 'read_only' }),
      null,
    )
    assert.equal(
      candidate({
        ...running,
        verification: resolveVerification(root, 'minimal'),
      } as RunState),
      null,
    )
  })

  withEnv({ PAN_PREFETCH_FULL: '0', PAN_GATE_CACHE: undefined }, () => {
    assert.equal(candidate(), null)
  })
  withEnv({ PAN_PREFETCH_FULL: undefined, PAN_GATE_CACHE: '0' }, () => {
    assert.equal(candidate(), null)
  })
})
