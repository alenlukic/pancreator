import assert from 'node:assert/strict'
import test from 'node:test'

import {
  proceduralExceptionRecords,
  validateProceduralException,
} from '../../src/lib/procedural-exceptions.js'

const pending = {
  schema_version: 1,
  client_id: 'retry-1',
  affected: 'procedure',
  classification: 'harness_defect',
  observed_defect: 'A gate requires a later-stage artifact.',
  evidence: ['gate.log:12'],
  workaround: 'Run the permitted check directly.',
  justification: 'The required evidence remains intact.',
  preserved_constraints: ['security', 'authorization'],
  required_follow_up: 'Repair gate ordering.',
}

test('pending recovery survives failed product output and Markdown verdict independently', () => {
  for (const result of ['success', 'failure', 'blocked']) {
    assert.deepEqual(
      proceduralExceptionRecords({ result, procedural_exceptions: [pending] }),
      [pending],
    )
  }
  const report = `## Procedural exceptions\n\n\`\`\`json\n${JSON.stringify({ procedural_exceptions: [pending] })}\n\`\`\`\n\n<!-- evidence-verdict: fail -->\n<!-- evidence-report: complete -->`
  assert.deepEqual(proceduralExceptionRecords(report), [pending])
  assert.equal(
    validateProceduralException(pending).classification,
    'harness_defect',
  )
  assert.throws(
    () =>
      proceduralExceptionRecords(`<!-- evidence-verdict: pass -->\n${report}`),
    /precede/,
  )
})

test('recovery records reject authority, forged attribution and incomplete justification', () => {
  for (const field of [
    'actor',
    'timestamp',
    'run_id',
    'waiver',
    'approval',
    'gate_result',
    'status',
    'scope',
  ]) {
    assert.throws(
      () => validateProceduralException({ ...pending, [field]: 'granted' }),
      /Authority and status/,
    )
  }
  assert.throws(
    () => validateProceduralException({ ...pending, evidence: [] }),
    /requires/,
  )
  assert.throws(
    () =>
      validateProceduralException({
        ...pending,
        required_follow_up: undefined,
      }),
    /requires/,
  )
  assert.throws(
    () => proceduralExceptionRecords({ procedural_exceptions: {} }),
    /array/,
  )
  assert.deepEqual(
    proceduralExceptionRecords({ summary: 'Historical output' }),
    [],
  )
  assert.throws(
    () =>
      proceduralExceptionRecords(
        '## Procedural exceptions\n## Procedural exceptions\n',
      ),
    /one Procedural/,
  )
})

test('revision envelopes extract only explicitly patched pending records', () => {
  assert.deepEqual(
    proceduralExceptionRecords({
      revises: 'previous',
      patch: { invocation_id: 'current', procedural_exceptions: [pending] },
    }),
    [pending],
  )
  for (const patch of [
    { invocation_id: 'current' },
    { invocation_id: 'current', procedural_exceptions: null },
  ]) {
    assert.deepEqual(
      proceduralExceptionRecords({ revises: 'previous', patch }),
      [],
    )
  }
  assert.throws(
    () =>
      proceduralExceptionRecords({
        revises: 'previous',
        patch: { procedural_exceptions: {} },
      }),
    /array/,
  )
})
