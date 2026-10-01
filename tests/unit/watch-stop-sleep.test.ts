import assert from 'node:assert/strict'
import test from 'node:test'

import { stopAwareSleep } from '../../src/lib/watch/session.js'

function recordingSleep(): {
  steps: number[]
  sleep: (milliseconds: number) => Promise<void>
} {
  const steps: number[] = []

  return {
    steps,
    sleep: async (milliseconds) => {
      steps.push(milliseconds)
    },
  }
}

test('a stop-aware sleep ends at the first poll that sees the worker stop', async () => {
  const { steps, sleep } = recordingSleep()
  let probes = 0

  await stopAwareSleep(
    () => {
      probes += 1
      return probes === 3
    },
    5_000,
    sleep,
  )(60_000)

  assert.deepEqual(steps, [5_000, 5_000, 5_000])
})

test('a stop-aware sleep without a stop sleeps the whole interval', async () => {
  const { steps, sleep } = recordingSleep()
  let probes = 0

  await stopAwareSleep(
    () => {
      probes += 1
      return false
    },
    25_000,
    sleep,
  )(60_000)

  assert.deepEqual(steps, [25_000, 25_000, 10_000])
  assert.equal(probes, 2, 'no probe runs once the interval is spent')
})

test('a stop probe that throws counts as no stop', async () => {
  const { steps, sleep } = recordingSleep()

  await stopAwareSleep(
    () => {
      throw new Error('index unreadable')
    },
    30_000,
    sleep,
  )(60_000)

  assert.deepEqual(steps, [30_000, 30_000])
})
