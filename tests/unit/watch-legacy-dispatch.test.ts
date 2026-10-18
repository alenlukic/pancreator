import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { summarizeDelegationObservation } from '../../src/lib/watch/record.js'
import { createTestTempDirectory } from '../temp.js'

test('legacy dispatch requires a matching terminal audit with valid chronology', () => {
  const root = createTestTempDirectory('watch-legacy-dispatch-')
  const run = 'run-legacy'
  const invocation = 'inv-legacy'
  const now = Date.now()
  const invocationPath = resolveRunLayout(root, run).invocation(
    invocation,
    '.json',
  ).absolute
  const auditPath = path.join(
    root,
    delegationExecutionPath(run, invocation, root),
  )
  const write = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value))
  }
  write(invocationPath, {
    schema_version: 1,
    run_id: run,
    invocation_id: invocation,
    created_at: new Date(now - 60_000).toISOString(),
    stage: { slug: 'implement', persona_executor: 'copilot' },
  })
  const audit = {
    schema_version: 1,
    run_id: run,
    invocation_id: invocation,
    stage: 'implement',
    executor: 'copilot',
    delegated_by: 'harness',
    recorded_at: new Date(now - 1000).toISOString(),
    exit_code: 0,
    timed_out: false,
  }
  for (const fields of [
    { stage: undefined },
    { stage: 'verify' },
    { executor: undefined },
    { executor: 'cursor' },
    { delegated_by: 'operator_session' },
    { recorded_at: undefined },
    { recorded_at: 'invalid' },
    { recorded_at: new Date(now - 60_001).toISOString() },
    { recorded_at: new Date(now + 60_000).toISOString() },
    { exit_code: undefined },
    { exit_code: null },
    { exit_code: 0.5 },
    { timed_out: undefined },
    { timed_out: 'false' },
    { run_id: 'other-run' },
    { invocation_id: 'other-invocation' },
  ]) {
    write(auditPath, { ...audit, ...fields })
    const summary = summarizeDelegationObservation(root, run, invocation)
    assert.equal(
      summary.observed,
      false,
      JSON.stringify(fields, (_key, value) => value ?? '<missing>'),
    )
    assert.equal(summary.source, null)
    assert.equal(summary.watch.coverage_ratio, null)
  }
  for (const fields of [
    {},
    { delegated_by: undefined },
    { exit_code: 1 },
    { exit_code: null, timed_out: true },
  ]) {
    write(auditPath, { ...audit, ...fields })
    const summary = summarizeDelegationObservation(root, run, invocation)
    assert.equal(summary.observed, true, JSON.stringify(fields))
    assert.equal(summary.source, 'external_executor')
    assert.equal(summary.watch.coverage_ratio, null)
  }
})
