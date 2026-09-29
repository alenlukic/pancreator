import assert from 'node:assert/strict'
import test from 'node:test'

import { tickHypervisor } from '../../src/lib/hypervisor.js'
import { createFixture } from '../fixture-template.js'

const unknownObservation = {
  agent_id: 'agent-1',
  run_id: 'run-1',
  invocation_id: 'invoke-1',
  persona: 'coder' as const,
  executor: 'cursor' as const,
  process_alive: null,
  last_transcript_at: null,
}

test('unknown liveness emits no quarantine event', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    observations: [unknownObservation],
  })

  assert.equal(result.agents[0]?.health, 'unknown')
  assert.deepEqual(result.quarantine_events, [])
})

test('dead agent emits one quarantine event immediately', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [
      {
        ...unknownObservation,
        process_alive: false,
      },
    ],
  })

  assert.equal(result.agents[0]?.health, 'dead')
  assert.equal(result.agents[0]?.recovery.quarantined, true)
  assert.equal(result.quarantine_events.length, 1)
  assert.equal(result.quarantine_events[0]?.health, 'dead')
  assert.equal(result.quarantine_events[0]?.agent_id, 'agent-1')
})

test('stalled agent emits quarantine event after two unchanged scans', () => {
  const root = createFixture()
  const stalledObs = {
    ...unknownObservation,
    process_alive: null,
    last_transcript_at: '2026-08-21T10:00:00.000Z',
  }

  tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [stalledObs],
  })
  tickHypervisor(root, {
    now: '2026-08-21T10:30:00.000Z',
    observations: [stalledObs],
  })
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:45:00.000Z',
    observations: [stalledObs],
  })

  assert.equal(result.agents[0]?.health, 'stalled')
  assert.equal(result.agents[0]?.recovery.quarantined, true)
  assert.equal(result.quarantine_events.length, 1)
  assert.equal(result.quarantine_events[0]?.health, 'stalled')
})

test('already-quarantined agent emits no second quarantine event', () => {
  const root = createFixture()
  const deadObs = { ...unknownObservation, process_alive: false }

  // First tick quarantines it.
  tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [deadObs],
  })
  // Second tick must not re-quarantine.
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:16:00.000Z',
    observations: [deadObs],
  })

  assert.deepEqual(result.quarantine_events, [])
})
