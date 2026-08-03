import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  scaffoldDataFromRequiredData,
  scaffoldStageOutput,
} from '../../src/lib/requirements/scaffold.js'
import type { Invocation } from '../../src/lib/types.js'

test('scaffold builds nested data from dotted required_data paths', () => {
  const data = scaffoldDataFromRequiredData({
    review: 'object',
    'review.verdict': 'string',
    'review.findings': 'array',
    'review.acceptance_results': 'array',
    'review.maintenance_assessment': 'string',
  })

  assert.deepEqual(data, {
    review: {
      verdict: '',
      findings: [],
      acceptance_results: [],
      maintenance_assessment: '',
    },
  })
})

test('scaffold refuses to overwrite a non-empty output without force', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-scaffold-'))
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const absolute = path.join(root, outputPath)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, '{"existing":true}\n', { flag: 'w' })

  const invocation = {
    invocation_id: 'implement-1',
    rubric: [],
    output: {
      path: outputPath,
      required_data: { implementation: 'object' },
    },
  } as unknown as Invocation

  assert.throws(
    () => scaffoldStageOutput(root, invocation, outputPath, false),
    /already exists/u,
  )
})

test('scaffold copies the contract manifest into a read attestation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-scaffold-'))
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const contractPath = 'runtime/logs/workflows/x/invocations/implement-1.md'
  const invocation = {
    invocation_id: 'implement-1',
    rubric: [],
    output: { path: outputPath, required_data: {} },
    contract_manifest: {
      contract_path: contractPath,
      contract_sha256: 'a'.repeat(64),
      byte_length: 120,
      line_count: 12,
      sections: [
        {
          id: '001-preamble',
          heading: 'Preamble',
          owner: 'worker',
          line_count: 4,
          sha256: 'b'.repeat(64),
        },
        {
          id: '002-task',
          heading: '## Task',
          owner: 'worker',
          line_count: 8,
          sha256: 'c'.repeat(64),
        },
      ],
    },
  } as unknown as Invocation

  const result = scaffoldStageOutput(root, invocation, outputPath, false)
  const attestation = result.output.invocation_attestation

  assert.ok(attestation)
  assert.equal(attestation.status, 'read')
  assert.equal(attestation.invocation_id, 'implement-1')
  assert.equal(attestation.contract_path, contractPath)
  assert.deepEqual(attestation.status === 'read' ? attestation.sections : [], [
    { id: '001-preamble', sha256: 'b'.repeat(64) },
    { id: '002-task', sha256: 'c'.repeat(64) },
  ])
})

test('scaffold omits the attestation for a legacy invocation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-scaffold-'))
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const invocation = {
    invocation_id: 'implement-1',
    rubric: [],
    output: { path: outputPath, required_data: {} },
  } as unknown as Invocation

  const result = scaffoldStageOutput(root, invocation, outputPath, false)

  assert.equal(result.output.invocation_attestation, undefined)
})
