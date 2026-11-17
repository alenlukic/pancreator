import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { decideRun } from '../../src/lib/engine.js'
import { traceContinuation } from '../../src/lib/intake/trace-continuation.js'
import {
  checkpoint,
  checksVariant,
  PASS,
  submitCurrentStage,
} from './delivery-helpers.js'

const SOURCE = 'src/adapter.mjs'
const TEST = 'tests/integration/adapter-trace.test.mjs'
const CHECK = 'trace.tests_run'

test('trace executes the declared test and binds the artifacts before operator approval', () => {
  const { root, runId } = checkpoint('prototype-trace@trace-prepared')
  const submitted = submitCurrentStage(root, runId)
  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation),
  )
  assert.equal(submitted.state.status, 'awaiting_operator')
  const history = submitted.state.stage_history.at(-1)!
  const gate = history.deterministic.find((entry) => entry.id === CHECK)!
  assert.equal(gate.passed, true)
  const evidence = JSON.parse(
    readFileSync(path.join(root, gate.evidence_path!), 'utf8'),
  )
  assert.equal(evidence.results.length, 1)
  assert.equal(evidence.results[0].file, TEST)
  assert.match(JSON.stringify(evidence.results[0].result), /# pass 1/u)
  assert.ok(
    history.trace_contract?.artifacts?.some((entry) => entry.path === SOURCE),
  )
  for (const relative of [SOURCE, TEST]) {
    const target = path.join(root, relative)
    const original = readFileSync(target, 'utf8')
    writeFileSync(target, `${original}\n`)
    assert.throws(() => decideRun(root, runId, 'approve', 'Approve drift'), {
      code: 'TRACE_CONTRACT_DRIFT',
    })
    writeFileSync(target, original)
  }
  assert.equal(
    decideRun(root, runId, 'approve', 'Approve validated trace').status,
    'succeeded',
  )
})

test('trace rejects nonexistent declared skeletons and tests before approval', () => {
  const { root, runId } = checkpoint('prototype-trace@trace-prepared')
  const submitted = submitCurrentStage(root, runId, 'success', [], () => {
    rmSync(path.join(root, SOURCE))
    rmSync(path.join(root, TEST))
  })
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.stage_history.at(-1)?.trace_contract, undefined)
  assert.throws(() => traceContinuation(root, runId), {
    code: 'TRACE_NOT_APPROVED',
  })
  assert.match(
    JSON.stringify(submitted.state.stage_history.at(-1)?.validation_errors),
    /skeleton_path|skeletons\[0\]\.path/u,
  )
  assert.match(
    JSON.stringify(submitted.state.stage_history.at(-1)?.validation_errors),
    /trace_test_path|trace_tests\[0\]\.path/u,
  )
})

test('trace refuses actual source drift when the unchanged tests fail', () => {
  const { root, runId } = checkpoint('prototype-trace@trace-prepared')
  const submitted = submitCurrentStage(root, runId, 'success', [], () => {
    writeFileSync(
      path.join(root, SOURCE),
      'export function createAdapter(provider) { return { amount: provider } }\n',
    )
  })
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.stage_history.at(-1)?.trace_contract, undefined)
  assert.throws(() => traceContinuation(root, runId), {
    code: 'TRACE_NOT_APPROVED',
  })
  const gate = submitted.state.stage_history
    .at(-1)!
    .deterministic.find((entry) => entry.id === CHECK)!
  assert.equal(gate.passed, false)
  assert.match(
    readFileSync(path.join(root, gate.evidence_path!), 'utf8'),
    /# fail 1/u,
  )
  assert.equal(
    decideRun(root, runId, 'approve', 'Retry failed trace').current_stage,
    'trace',
  )
  assert.throws(() => traceContinuation(root, runId), {
    code: 'TRACE_NOT_APPROVED',
  })
})

test('trace fails closed without a runner and when a declared Node test file executes no scenario', () => {
  const variant = checksVariant('trace-no-runner', {
    static: { probes: [], commands: [PASS] },
    configuration: { probes: [], commands: [PASS] },
  })
  const missing = checkpoint('prototype-trace@trace-prepared', variant)
  const result = submitCurrentStage(missing.root, missing.runId)
  assert.equal(result.record.outcome, 'failure')
  assert.match(
    JSON.stringify(result.record.evaluation),
    /Configure repository-check profile/u,
  )
  for (const content of [
    '// no registered tests\n',
    "import test from 'node:test'; test.skip('not executed', () => {});\n",
  ]) {
    const { root, runId } = checkpoint('prototype-trace@trace-prepared')
    const submitted = submitCurrentStage(root, runId, 'success', [], () => {
      writeFileSync(path.join(root, TEST), content)
    })
    assert.equal(
      submitted.record.outcome,
      'failure',
      JSON.stringify(submitted.record.evaluation),
    )
    assert.equal(
      submitted.state.stage_history.at(-1)?.trace_contract,
      undefined,
    )
    assert.throws(() => traceContinuation(root, runId), {
      code: 'TRACE_NOT_APPROVED',
    })
  }
})
