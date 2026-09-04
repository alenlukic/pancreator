import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  isUntouchedScaffold,
  readInvocationFromPath,
  scaffoldDataFromRequiredData,
  scaffoldStageOutput,
} from '../../src/lib/requirements/scaffold.js'
import { PanError } from '../../src/lib/errors.js'
import type { Invocation } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

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
  const root = createTestTempDirectory('pan-scaffold-')
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

test('scaffold copies the contract manifest into a pending attestation', () => {
  const root = createTestTempDirectory('pan-scaffold-')
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const contractPath = 'runtime/logs/workflows/x/invocations/implement-1.md'
  const invocation = {
    invocation_id: 'implement-1',
    stage: { model: 'gpt-5.6-sol' },
    rubric: [
      { id: 'implement.lint', hard: true },
      { id: 'implement.unit_tests', hard: true },
    ],
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
      guidance: [
        {
          policy_id: 'ENG-001',
          source_path: 'governance/handbooks/eng/engineering.md',
          content_sha256: 'd'.repeat(64),
          read_trigger: 'Read this guidance before the governed work.',
        },
      ],
    },
  } as unknown as Invocation

  const result = scaffoldStageOutput(root, invocation, outputPath, false)
  const attestation = result.output.invocation_attestation

  assert.ok(attestation)
  // The scaffold cannot know whether the worker read the contract, so it must
  // not prefill a claim the worker has to make itself.
  assert.equal(attestation.status, 'pending')
  assert.equal(attestation.invocation_id, 'implement-1')
  assert.equal(attestation.model, 'gpt-5.6-sol')
  assert.equal(attestation.contract_path, contractPath)
  assert.equal(result.output.criteria.length, invocation.rubric.length)
  assert.ok(
    result.output.criteria.every(
      (criterion) => criterion.result === 'unevaluated',
    ),
  )
  assert.equal(
    attestation.status === 'pending' ? attestation.contract_sha256 : '',
    'a'.repeat(64),
  )
  // Per-section digest echoes were transcription theater and are no longer
  // scaffolded. Guidance entries return as read evidence: identity fields are
  // prefilled mechanically so the worker owes only the status flip and the
  // final-line quote its read produces.
  assert.equal(
    attestation.status === 'pending' ? attestation.sections : null,
    undefined,
  )
  assert.deepEqual(
    attestation.status === 'pending' ? attestation.guidance : null,
    [
      {
        policy_id: 'ENG-001',
        source_path: 'governance/handbooks/eng/engineering.md',
        content_sha256: 'd'.repeat(64),
        status: 'pending',
      },
    ],
  )

  const legacy = {
    invocation_id: 'implement-1',
    rubric: [],
    output: {
      path: 'runtime/logs/workflows/x/outputs/legacy.json',
      required_data: {},
    },
  } as unknown as Invocation

  assert.equal(
    scaffoldStageOutput(root, legacy, legacy.output.path, false).output
      .invocation_attestation,
    undefined,
  )
})

test('the scaffold interface rejects the Markdown contract by artifact type', () => {
  const root = createTestTempDirectory('pan-scaffold-')
  const markdownPath = 'runtime/logs/workflows/x/invocations/implement-1.md'
  const jsonPath = 'runtime/logs/workflows/x/invocations/implement-1.json'
  const absoluteJson = path.join(root, jsonPath)

  mkdirSync(path.dirname(absoluteJson), { recursive: true })
  writeFileSync(path.join(root, markdownPath), '# Card\n')
  writeFileSync(absoluteJson, '{"invocation_id":"implement-1"}\n')

  // The error names the failure as an artifact-type mismatch and points at
  // the sibling snapshot — never a generic JSON parse error.
  assert.throws(
    () => readInvocationFromPath(root, markdownPath),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVOCATION_ARTIFACT_TYPE' &&
      error.message.includes(jsonPath),
  )

  rmSync(absoluteJson)

  assert.throws(
    () => readInvocationFromPath(root, markdownPath),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVOCATION_ARTIFACT_TYPE' &&
      error.message.includes('.json snapshot'),
  )
})

test('scaffold retains only non-transient brief sources as artifacts', () => {
  const root = createTestTempDirectory('pan-scaffold-')
  const sourcePath =
    'runtime/logs/workflows/x/artifacts/json/implement-1.brief.json'
  const renderedPath =
    'runtime/logs/workflows/x/artifacts/html/implement-1.html'
  const invocation = {
    invocation_id: 'implement-1',
    rubric: [],
    output: {
      path: 'runtime/logs/workflows/x/outputs/out.json',
      required_data: {},
      operator_brief: {
        source_path: sourcePath,
        rendered_path: renderedPath,
      },
    },
  } as unknown as Invocation

  const retained = scaffoldStageOutput(
    root,
    invocation,
    invocation.output.path,
    false,
  )

  assert.deepEqual(
    retained.output.artifacts.map((artifact) => artifact.path),
    [renderedPath, sourcePath],
  )

  invocation.output.path = 'runtime/logs/workflows/x/outputs/transient.json'
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  brief.source_lifecycle = 'transient'

  const transient = scaffoldStageOutput(
    root,
    invocation,
    invocation.output.path,
    false,
  )

  assert.deepEqual(
    transient.output.artifacts.map((artifact) => artifact.path),
    [renderedPath],
  )
})

test('isUntouchedScaffold recognizes legacy not_applicable and new unevaluated scaffolds', () => {
  const legacy = {
    summary: '',
    criteria: [
      { id: 'a', result: 'not_applicable', evidence: [], explanation: '' },
    ],
  }
  const current = {
    summary: '',
    criteria: [
      { id: 'a', result: 'unevaluated', evidence: [], explanation: '' },
    ],
  }

  assert.equal(isUntouchedScaffold(legacy), true)
  assert.equal(isUntouchedScaffold(current), true)
})
