/**
 * Run 2 of the stage-worker efficiency plan: QA ran on every verify visit,
 * and blocked on criteria only an operator's live observation could settle.
 * The planner now tags each criterion with a proof type, and the QA evidence
 * worker runs only for a `live` criterion. A request whose criteria carry no
 * proof type keeps QA, so a legacy or unplanned run loses nothing.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { attachTargetInstructionEvidence } from '../helpers.js'
import {
  checkpoint,
  submitStageOutput,
  type CheckpointVariant,
} from './delivery-helpers.js'

// The request lives under the ignored runtime tree, so writing it leaves the
// tracked workspace the implement stage reports on untouched.
const TAGGED_REQUEST = 'runtime/tagged-request.md'

function taggedRequest(key: string, proof: string): CheckpointVariant {
  return {
    key,
    run: { requestPath: TAGGED_REQUEST },
    fixture: (root) =>
      writeFileSync(
        path.join(root, TAGGED_REQUEST),
        [
          '# Request',
          '',
          'Build a dependency-free workflow harness.',
          '',
          '## Acceptance criteria',
          '',
          `1. AC-01 [proof: ${proof}] The workflow advances to ship.`,
          '',
        ].join('\n'),
      ),
  }
}

const TEST_PROOF = taggedRequest('proof-test-request', 'test')
const LIVE_PROOF = taggedRequest('proof-live-request', 'live')

test('a request whose criteria are all test-proven runs verify without QA', () => {
  const { root, state, invocation, workflow, runId } = checkpoint(
    'delivery@verify-prepared',
    TEST_PROOF,
  )

  assert.ok(invocation)
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review'],
  )
  assert.equal(invocation.evidence_worker_skips?.length, 1)
  assert.equal(invocation.evidence_worker_skips?.[0].role, 'qa')
  assert.equal(invocation.evidence_worker_skips?.[0].run_when, 'live_criteria')
  assert.match(
    invocation.evidence_worker_skips?.[0].reason ?? '',
    /no acceptance criterion has proof `live` \(1 test\)/u,
  )
  assert.equal(invocation.output.required_data['verify.qa_cases'], undefined)

  const card = readFileSync(
    path.join(root, state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /### Evidence workers not launched/u)
  assert.match(card, /`qa` \(`qa-tester`\) did not run/u)

  // The verifier owes no QA case on this visit.
  const verified = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
    [],
    (output) => {
      delete (output.data.verify as Record<string, unknown>).qa_cases
    },
  )

  assert.equal(
    verified.record.outcome,
    'success',
    JSON.stringify(verified.record.evaluation),
  )
})

test('a live criterion keeps the QA worker and its cases', () => {
  const { invocation } = checkpoint('delivery@verify-prepared', LIVE_PROOF)

  assert.ok(invocation)
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review', 'qa'],
  )
  assert.equal(invocation.evidence_worker_skips, undefined)
  assert.equal(invocation.output.required_data['verify.qa_cases'], 'array')
})

test('a request with no proof tags keeps QA', () => {
  const { invocation } = checkpoint('delivery@verify-prepared')

  assert.ok(invocation)
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review', 'qa'],
  )
  assert.equal(invocation.evidence_worker_skips, undefined)
})

function remediate(
  root: string,
  runId: string,
  workflow: Parameters<typeof stageBySlug>[0],
  changedPaths: string[],
): void {
  const failed = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = {
        verdict: 'fail_remedial',
        findings: [
          {
            id: 'VR-01',
            severity: 'blocker',
            source: 'review',
            statement: 'The repair target is wrong.',
            evidence: ['fixture'],
          },
        ],
        qa_cases: [
          {
            id: 'TP-01',
            steps: 'Run workflow fixture',
            expected: 'advance',
            actual: 'stalled',
            result: 'fail',
          },
        ],
        acceptance_results: [
          { id: 'AC-01', result: 'fail', evidence: ['The fixture stalled.'] },
        ],
        remediation_guidance: 'Repair the target the finding names.',
      }
    },
  )

  assert.equal(failed.record.outcome, 'failure')

  const remediated = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'remediate'),
    'success',
    [],
    (output) => {
      for (const changed of changedPaths) {
        writeFileSync(
          path.join(root, changed),
          `export const repaired = '${changed}'\n`,
        )
      }

      output.workspace_changes = {
        attribution: 'internal',
        paths: changedPaths,
        explanation: 'The remediation repaired the failing case.',
      }
      ;(output.data.implementation as Record<string, unknown>).changed_files =
        changedPaths
      attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
    },
  )

  assert.equal(remediated.state.current_stage, 'verify')
}

test('a full return visit gives the reviewer its return-visit scope and the routing verdict', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const declared = stageBySlug(workflow, 'verify').evidence_workers ?? []
  const review = declared.find((worker) => worker.role === 'review')
  const qa = declared.find((worker) => worker.role === 'qa')

  assert.ok(review?.return_scope)
  assert.ok(qa)

  remediate(root, runId, workflow, [
    'src/scoped-a.ts',
    'src/scoped-b.ts',
    'src/scoped-c.ts',
    'src/scoped-d.ts',
  ])

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.scoped_return, undefined)

  const workers = new Map(
    (invocation.evidence_workers ?? []).map((worker) => [worker.role, worker]),
  )

  assert.equal(workers.get('review')?.scope, review.return_scope)
  assert.equal(workers.get('qa')?.scope, qa.scope)

  const routing = invocation.inputs.remediation_return?.routing_output_path

  assert.ok(routing)
  assert.match(
    readFileSync(
      path.join(root, workers.get('review')?.brief_path ?? ''),
      'utf8',
    ),
    new RegExp(
      `The verdict that routed it, with the prior findings, is \`${routing}\``,
      'u',
    ),
  )
})

test('a scoped return without QA assigns only the review dimension, under its return scope', () => {
  const { root, runId, workflow, state } = checkpoint(
    'delivery@verify-prepared',
    TEST_PROOF,
  )
  const review = (stageBySlug(workflow, 'verify').evidence_workers ?? []).find(
    (worker) => worker.role === 'review',
  )

  remediate(root, runId, workflow, ['src/scoped-a.ts'])

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.deepEqual(
    invocation.scoped_return?.dimensions.map((dimension) => [
      dimension.role,
      dimension.scope,
    ]),
    [['review', review?.return_scope]],
  )
  assert.equal(invocation.evidence_worker_skips?.[0].role, 'qa')
  assert.equal(invocation.output.required_data['verify.qa_cases'], undefined)

  const card = readFileSync(
    path.join(
      root,
      prepared.state.current_invocation?.markdown_path ??
        state.current_invocation?.markdown_path ??
        '',
    ),
    'utf8',
  )

  assert.match(card, /#### review dimension/u)
  assert.doesNotMatch(card, /#### qa dimension/u)
  assert.doesNotMatch(card, /record each in `data\.verify\.qa_cases`/u)
})
