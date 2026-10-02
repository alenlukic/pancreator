/**
 * A process that died before the watch armed reports the exit code its
 * `bin/pan-run` record holds (AC-008). A recorded exit ends the watch even
 * when the pid was reused, and a cadence sleep ends when the process exits.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { watchProcess } from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'

test('AC-008: dead-at-arm path returns exited with numeric status when exit record holds integer code', async () => {
  const root = createTestTempDirectory('watch-process-dead-arm-')
  const recordDir = path.join(root, 'runtime', 'logs', 'shell', 'dead-001')
  const dead = spawnSync(process.execPath, ['-e', '0']).pid as number
  const startedAt = new Date(Date.now() - 1_000).toISOString()

  mkdirSync(recordDir, { recursive: true })
  // The field names bin/pan-run writes.
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({
      schema_version: 1,
      label: 'dead',
      command: ['test'],
      pid: dead,
      wrapper_pid: dead,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      exit_code: 42,
      signal: null,
    }),
  )

  const result = await watchProcess(root, {
    pid: dead,
    label: 'dead-arm',
    exitRecordPath: 'runtime/logs/shell/dead-001/record.json',
    cadenceSeconds: 0.1,
    timeoutSeconds: 1,
  })

  assert.equal(result.state, 'exited', `expected exited, got ${result.state}`)
  assert.equal(result.exit_status, 42)
})

test('a recorded exit code ends the watch even when the pid now names a live process', async () => {
  const root = createTestTempDirectory('watch-process-reused-pid-')
  const recordDir = path.join(root, 'runtime', 'logs', 'shell', 'reused-001')

  mkdirSync(recordDir, { recursive: true })
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({
      schema_version: 1,
      label: 'reused',
      command: ['test'],
      pid: process.pid,
      wrapper_pid: process.pid,
      ended_at: new Date().toISOString(),
      exit_code: 7,
      signal: null,
    }),
  )

  const result = await watchProcess(root, {
    pid: process.pid,
    label: 'reused-pid',
    exitRecordPath: 'runtime/logs/shell/reused-001/record.json',
    sleep: () =>
      Promise.reject(new Error('the watch slept on a recorded exit')),
  })

  assert.equal(result.state, 'exited')
  assert.equal(result.exit_status, 7)
  assert.equal(result.wakes, 1)
})

test('an exit code recorded during the watch ends it while the pid stays alive', async () => {
  const root = createTestTempDirectory('watch-process-late-record-')
  const recordDir = path.join(root, 'runtime', 'logs', 'shell', 'late-001')
  const record = {
    schema_version: 1,
    label: 'late',
    command: ['test'],
    pid: process.pid,
    wrapper_pid: process.pid,
    ended_at: null as string | null,
    exit_code: null as number | null,
    signal: null,
  }
  const recordFile = path.join(recordDir, 'record.json')

  mkdirSync(recordDir, { recursive: true })
  writeFileSync(recordFile, JSON.stringify(record))

  const result = await watchProcess(root, {
    pid: process.pid,
    label: 'late-record',
    exitRecordPath: 'runtime/logs/shell/late-001/record.json',
    cadenceSeconds: 60,
    timeoutSeconds: 120,
    sleep: async () => {
      writeFileSync(
        recordFile,
        JSON.stringify({
          ...record,
          ended_at: new Date().toISOString(),
          exit_code: 3,
        }),
      )
    },
  })

  assert.equal(result.state, 'exited')
  assert.equal(result.exit_status, 3)
  assert.equal(result.wakes, 1)
})

test('a process watch wakes at the exit rather than at the next cadence', async () => {
  const root = createTestTempDirectory('watch-process-early-wake-')
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], {
    stdio: 'ignore',
  })
  const requested: number[] = []

  const result = await watchProcess(root, {
    pid: child.pid as number,
    label: 'early-wake',
    cadenceSeconds: 60,
    timeoutSeconds: 60,
    pollMs: 20,
    sleep: async (milliseconds) => {
      requested.push(milliseconds)
      await new Promise((resolve) => setTimeout(resolve, milliseconds))
    },
  })

  assert.equal(result.state, 'exited')
  assert.equal(result.wakes, 1)
  assert.ok(
    requested.every((milliseconds) => milliseconds <= 20),
    'each sleep is one stop poll',
  )
  assert.ok(
    requested.reduce((total, milliseconds) => total + milliseconds, 0) < 60_000,
    'the watch stopped sleeping before the cadence came due',
  )
})
