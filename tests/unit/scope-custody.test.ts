import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  observeToolWrite,
  withinWriteRoots,
} from '../../src/lib/executors/scope-custody.js'
import {
  updateDelegationLiveRecord,
  writeDelegationLiveLaunch,
  type DelegationLiveRecord,
  type DelegationWriteObservation,
} from '../../src/lib/executors/delegation-live.js'
import { isDelegationWriteBoundary } from '../../src/lib/executors/scope-custody.js'
import { createTestTempDirectory } from '../temp.js'

test('write authorization resolves missing leaves and rejects lexical and symlink escapes', () => {
  const root = createTestTempDirectory('scope-roots-')
  const allowed = path.join(root, 'allowed')
  const foreign = path.join(root, 'foreign')
  mkdirSync(allowed)
  mkdirSync(foreign)
  symlinkSync(foreign, path.join(allowed, 'escape'))
  assert.equal(withinWriteRoots(path.join(allowed, 'new.txt'), [allowed]), true)
  assert.equal(
    withinWriteRoots(path.join(allowed, '../foreign/new.txt'), [allowed]),
    false,
  )
  assert.equal(
    withinWriteRoots(path.join(allowed, 'escape/new.txt'), [allowed]),
    false,
  )
  assert.equal(withinWriteRoots('relative.txt', [allowed]), false)
})

test('tool writes retain denied and completed write evidence without interpreting read failures as writes', () => {
  const pending = new Map<string, string[]>()
  const observations: Omit<DelegationWriteObservation, 'evidence'>[] = []
  const emit = (type: string, data: object) =>
    observeToolWrite(
      JSON.stringify({ type, data }),
      pending,
      '/workspace',
      (item) => observations.push(item),
    )
  emit('tool.execution_start', {
    toolCallId: '1',
    toolName: 'create',
    arguments: { path: '../foreign/file.txt' },
  })

  emit('tool.execution_complete', {
    toolCallId: '1',
    success: false,
    result: { content: 'EPERM: operation not permitted' },
  })
  emit('tool.execution_start', {
    toolCallId: '2',
    toolName: 'edit',
    arguments: { path: 'source.ts' },
  })
  emit('tool.execution_complete', { toolCallId: '2', success: true })
  emit('tool.execution_start', {
    toolCallId: '3',
    toolName: 'view',
    arguments: { path: '/private/read.txt' },
  })
  emit('tool.execution_complete', {
    toolCallId: '3',
    success: false,
    result: 'permission denied',
  })
  emit('tool.execution_start', {
    toolCallId: '4',
    toolName: 'bash',
    arguments: { command: 'write outside' },
  })
  emit('tool.execution_complete', {
    toolCallId: '4',
    success: false,
    result: 'EACCES',
  })
  assert.deepEqual(observations, [
    { path: '/foreign/file.txt', outcome: 'denied' },
    { path: '/workspace/source.ts', outcome: 'written' },
    { path: '<unresolved denied write>', outcome: 'denied' },
  ])
  assert.equal(pending.size, 0)
})

test('launch custody fixes process identity and boundary and permits only appended observations', () => {
  const root = createTestTempDirectory('scope-custody-')
  const timestamp = new Date().toISOString()
  const record: DelegationLiveRecord = {
    schema_version: 1,
    executor: 'copilot',
    run_id: 'run-1',
    invocation_id: 'inv-1',
    role: 'stage',
    attempt: 1,
    launch_id: 'launch-1',
    launched_at: timestamp,
    heartbeat_at: timestamp,
    relay_pid: 101,
    relay_start_identity: 'relay-start',
    child_pid: 102,
    child_start_identity: 'child-start',
    sequence: 0,
    stream_sequences: { stdout: 0, stderr: 0 },
    truncated: false,
    write_boundary: {
      mode: 'sandbox-exec',
      reason: '',
      write_roots: [root],
      effective_write_roots: [root],
    },
    write_observations: [
      { path: '/foreign/file.txt', outcome: 'denied', evidence: 'event 1' },
    ],
  }
  writeDelegationLiveLaunch(root, record)
  assert.throws(
    () => updateDelegationLiveRecord(root, { ...record, child_pid: 103 }),
    /regress/u,
  )
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, {
        ...record,
        relay_start_identity: 'other',
      }),
    /regress/u,
  )
  assert.ok(record.write_boundary)
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, {
        ...record,
        write_boundary: {
          write_roots: [root],
          effective_write_roots: [root],
          mode: 'none',
          reason: 'disabled',
        },
      }),
    /regress/u,
  )
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, { ...record, write_observations: [] }),
    /regress/u,
  )
  record.write_observations?.push({
    path: '/foreign/second.txt',
    outcome: 'denied',
    evidence: 'event 2',
  })
  updateDelegationLiveRecord(root, record)
  record.ended_at = timestamp
  record.exit_code = 0
  updateDelegationLiveRecord(root, record)
  assert.throws(() => updateDelegationLiveRecord(root, record), /regress/u)
})

test('write boundary decoding rejects relative roots and inconsistent enforcement claims', () => {
  assert.equal(
    isDelegationWriteBoundary({
      mode: ['sandbox-exec'],
      reason: '',
      write_roots: ['/runtime'],
      effective_write_roots: ['/runtime'],
    }),
    false,
  )
  assert.equal(
    isDelegationWriteBoundary({
      mode: 'sandbox-exec',
      reason: '',
      write_roots: ['relative'],
      effective_write_roots: ['/runtime'],
    }),
    false,
  )
  assert.equal(
    isDelegationWriteBoundary({
      mode: 'none',
      reason: '',
      write_roots: ['/runtime'],
      effective_write_roots: ['/runtime'],
    }),
    false,
  )
  assert.equal(
    isDelegationWriteBoundary({
      mode: 'sandbox-exec',
      reason: 'unavailable',
      write_roots: ['/runtime'],
      effective_write_roots: ['/runtime'],
    }),
    false,
  )
})
