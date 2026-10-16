import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { traceRegistryIds } from '../../src/lib/validators/stage/plan-trace.js'
import {
  canonicalVerificationEvidencePath,
  finishVerificationEvidence,
  normalizeVerificationEvidence,
  prepareVerificationEvidence,
  repairVerificationSubmission,
  verificationEvidencePacketPath,
} from '../../src/lib/verification-evidence.js'
import type {
  DeterministicResult,
  Invocation,
  RunState,
  StageOutput,
} from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function fixture() {
  const root = createTestTempDirectory('verification-packet-')
  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      installation_mode: 'self_development',
      state_root: 'runtime',
      workspace_root: '.',
    }),
  )
  const state = { run_id: 'packet-test', workspace_root: '.' } as RunState
  const invocation = {
    invocation_id: '03_verify-1_12345678',
    run_id: state.run_id,
    stage: { slug: 'verify', persona: 'verifier' },
    inputs: {
      references: [
        {
          path: 'implementation.json',
          description: 'Implementation evidence',
          retrieval: 'required',
        },
      ],
    },
    workspace_before: { fingerprint: 'current-source' },
    output: { path: 'runtime/output.json', required_data: {} },
    rubric: [],
  } as unknown as Invocation
  writeFileSync(
    path.join(root, 'implementation.json'),
    '{"observed":"working"}\n',
  )
  return { root, state, invocation }
}

function output(invocation: Invocation, verdict = 'pass'): StageOutput {
  return {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: verdict === 'pass' ? 'success' : 'failure',
    summary: 'Observed behavior',
    artifacts: [],
    criteria: [],
    risks: [],
    unknowns: [],
    data: {
      verify: {
        verdict,
        findings: [],
        acceptance_results: [
          {
            id: 'AC-1',
            result: verdict === 'pass' ? 'pass' : 'fail',
            evidence: ['Observed result'],
          },
        ],
      },
    },
  }
}

test('trace registry arrays and keyed definitions expose the same real identities without creating absent mappings', () => {
  assert.deepEqual(
    traceRegistryIds([
      { id: 'C-01', statement: 'Preserve behavior' },
      { id: 'OOS-01', statement: 'Excluded work' },
    ]),
    ['C-01', 'OOS-01'],
  )
  assert.deepEqual(
    traceRegistryIds({
      'C-01': 'Preserve behavior',
      'OOS-01': { description: 'Excluded work' },
    }),
    ['C-01', 'OOS-01'],
  )
  assert.deepEqual(
    traceRegistryIds({ 'C-01': '', 'C-02': null, 'C-03': {} }),
    [],
  )
  assert.deepEqual(
    traceRegistryIds({
      'C-01': { id: 'C-02', statement: 'Conflicting identity' },
    }),
    ['C-02'],
  )
})

test('structural normalization retains failures, observations, and every ordered step and citation value', () => {
  const value = {
    result: 'failure',
    data: {
      verify: {
        verdict: 'fail_remedial',
        findings: [{ severity: 'blocker', statement: 'A real failure' }],
        qa_cases: [
          {
            id: 'case',
            steps: ['First command', 'Second command'],
            expected: 'Expected',
            actual: 'Actual failure',
            result: 'fail',
          },
        ],
        gate_evidence_citations: [
          {
            profile_name: 'fast',
            workspace_fingerprint: 'source',
            log_path: 'evidence.log',
          },
        ],
      },
    },
  }
  const repairs = normalizeVerificationEvidence(value)
  assert.equal(repairs.length, 4)
  assert.equal(value.result, 'failure')
  assert.equal(value.data.verify.verdict, 'fail_remedial')
  assert.equal(value.data.verify.qa_cases[0]!.actual, 'Actual failure')
  assert.equal(value.data.verify.qa_cases[0]!.result, 'fail')
  assert.deepEqual(value.data.verify.findings, [
    { severity: 'blocker', statement: 'A real failure' },
  ])
  assert.equal(
    value.data.verify.qa_cases[0]!.steps as unknown,
    'First command\nSecond command',
  )
  assert.deepEqual(value.data.verify.gate_evidence_citations[0], {
    profile: 'fast',
    fingerprint: 'source',
    evidence_path: 'evidence.log',
  })
  assert.equal(normalizeVerificationEvidence(value).length, 0)
})

test('conflicting aliases and unsupported step values are not guessed into valid proof', () => {
  const value = {
    data: {
      verify: {
        qa_cases: [{ steps: ['Actual step', 2] }],
        gate_evidence_citations: [{ path: 'first', log_path: 'second' }],
      },
    },
  }
  assert.equal(normalizeVerificationEvidence(value).length, 0)
  assert.deepEqual(value.data.verify.qa_cases[0]!.steps, ['Actual step', 2])
  assert.deepEqual(value.data.verify.gate_evidence_citations[0], {
    path: 'first',
    log_path: 'second',
  })
})

test('verification extends the same packet across attempts and preserves earlier failed signal and input digests', () => {
  const { root, state, invocation } = fixture()
  const first = prepareVerificationEvidence(root, state, invocation)
  assert.equal(first.status, 'pending')
  assert.equal(first.incoming[0]!.available, true)
  assert.equal(first.incoming[0]!.required, true)
  const digest = first.incoming[0]!.sha256
  const failed = {
    id: 'verify.final_fast',
    type: 'shell',
    hard: true,
    passed: false,
    explanation: 'An assertion failed',
  } as DeterministicResult
  const failure = finishVerificationEvidence(
    root,
    state,
    invocation,
    output(invocation, 'fail_remedial'),
    [failed],
    'failure',
  )
  assert.equal(failure.status, 'failed')
  writeFileSync(
    path.join(root, 'implementation.json'),
    '{"observed":"repaired"}\n',
  )
  const next = { ...invocation, invocation_id: '03_verify-2_87654321' }
  const reopened = prepareVerificationEvidence(root, state, next)
  assert.equal(reopened.verifications.length, 1)
  assert.equal(reopened.checks[0]!.passed, false)
  assert.equal(reopened.prior_incoming[0]!.sha256, digest)
  const passed = {
    ...failed,
    passed: true,
    explanation: 'Fast assertions passed',
    verified_source: { fingerprint: 'current-source', profile: 'fast' },
  }
  const final = finishVerificationEvidence(
    root,
    state,
    next,
    output(next),
    [passed],
    'success',
  )
  assert.equal(final.status, 'passed')
  assert.equal(final.verifications.length, 2)
  assert.equal(final.verifications[0]!.verdict, 'fail_remedial')
  assert.equal(final.checks.length, 2)
  assert.equal(final.checks[0]!.passed, false)
  assert.equal(final.checks[1]!.passed, true)
  assert.equal(
    JSON.parse(
      readFileSync(
        verificationEvidencePacketPath(root, state.run_id).absolute,
        'utf8',
      ),
    ).status,
    'passed',
  )
})

test('target evidence outside a detached harness is resolved only within its declared workspace', () => {
  const { root, state, invocation } = fixture()
  const workspace = createTestTempDirectory('detached-evidence-target-')
  const evidence = path.join(workspace, 'target-evidence.json')
  writeFileSync(evidence, '{"actual":"target observation"}')
  const foreign = createTestTempDirectory('unrelated-evidence-root-')
  const unrelated = path.join(foreign, 'private.json')
  writeFileSync(unrelated, 'unrelated data')
  const packet = prepareVerificationEvidence(
    root,
    { ...state, workspace_root: workspace },
    {
      ...invocation,
      inputs: {
        references: [
          {
            path: evidence,
            description: 'Target evidence',
            retrieval: 'required',
          },
          {
            path: unrelated,
            description: 'Outside allowed roots',
            retrieval: 'required',
          },
        ],
      },
    },
  )
  assert.equal(packet.incoming[0]!.available, true)
  assert.equal(packet.incoming[1]!.available, false)
})

test('a malformed packet envelope is repaired from actual inputs with its original bytes retained', () => {
  const { root, state, invocation } = fixture()
  const location = verificationEvidencePacketPath(root, state.run_id)
  mkdirSync(path.dirname(location.absolute), { recursive: true })
  const original = '{"meaningful-original":broken-json'
  writeFileSync(location.absolute, original)
  const repaired = prepareVerificationEvidence(root, state, invocation)
  assert.equal(repaired.status, 'pending')
  assert.equal(repaired.incoming[0]!.available, true)
  assert.equal(repaired.structural_repairs.length, 1)
  assert.equal(
    readFileSync(path.join(root, repaired.prior_incoming[0]!.path), 'utf8'),
    original,
  )
})

test('submission repair records the original and keeps actual failure declarations unchanged', () => {
  const { root, state, invocation } = fixture()
  const value = {
    ...output(invocation, 'fail_remedial'),
    data: {
      verify: {
        verdict: 'fail_remedial',
        qa_cases: [
          {
            id: 'case',
            steps: ['One', 'Two'],
            result: 'fail',
            actual: 'Bad output',
          },
        ],
      },
    },
  }
  const packet = repairVerificationSubmission(
    root,
    state,
    invocation,
    invocation.output.path,
    value,
  )
  assert.equal(packet.structural_repairs.length, 1)
  const saved = JSON.parse(
    readFileSync(path.join(root, invocation.output.path), 'utf8'),
  )
  assert.equal(saved.result, 'failure')
  assert.equal(saved.data.verify.qa_cases[0].result, 'fail')
  assert.equal(saved.data.verify.qa_cases[0].steps, 'One\nTwo')
  assert.equal(saved.data.verify.evidence_packet.status, 'pending')
})

test('recorded invocation aliases repair only citations whose underlying artifact exists', () => {
  const { root, state } = fixture()
  const runDirectory = path.dirname(
    path.dirname(verificationEvidencePacketPath(root, state.run_id).absolute),
  )
  const agent = runDirectory
  mkdirSync(path.join(agent, 'evidence'), { recursive: true })
  writeFileSync(
    path.join(agent, 'state.json'),
    JSON.stringify({ run_id: state.run_id, schema_version: 1 }),
  )
  writeFileSync(
    path.join(agent, 'invocation-aliases.json'),
    JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      aliases: { '99_verify-1_abcd1234': '03_verify-1_abcd1234' },
    }),
  )
  const actual = path.join(
    agent,
    'evidence/03_verify-1_abcd1234.qa-evidence.md',
  )
  writeFileSync(actual, 'The same real observations')
  const old = path.relative(
    root,
    path.join(agent, 'evidence/99_verify-1_abcd1234.qa-evidence.md'),
  )
  assert.equal(
    canonicalVerificationEvidencePath(root, old),
    path.relative(root, actual),
  )
  assert.equal(
    canonicalVerificationEvidencePath(root, old.replace(/^runtime/u, '../..')),
    path.relative(root, actual),
  )
  const absent = old.replace('qa-evidence', 'missing')
  assert.equal(canonicalVerificationEvidencePath(root, absent), absent)
})
