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
