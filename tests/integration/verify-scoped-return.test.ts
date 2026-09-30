/**
 * HR-003 of the 2026-09-29 efficiency audit: every verify visit ran two
 * evidence workers and a verifier, and on small return visits that fixed
 * floor cost more than the repair it checked. A return visit that serves a
 * small, bounded remediation now runs the verifier alone, which records both
 * evidence dimensions in its own output.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { attachTargetInstructionEvidence } from '../helpers.js'
import type { StageOutput, WorkflowDefinition } from '../../src/lib/types.js'
import { checkpoint, submitStageOutput } from './delivery-helpers.js'

/** A failing verdict with no blocker: one failed QA case and one finding. */
function remedialVerify(): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: 'VS-01',
        severity: 'high',
        source: 'qa',
        statement: 'The fixture case fails on one input.',
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
    remediation_guidance: 'Rerun the workflow fixture; it stalls on one input.',
  }
}

function failThenRemediate(
  root: string,
  runId: string,
  workflow: WorkflowDefinition,
  changedPaths: string[],
): void {
  submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = remedialVerify()
    },
  )

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

  assert.equal(remediated.record.outcome, 'success')
  assert.equal(remediated.state.current_stage, 'verify')
}

function withDimensions(output: StageOutput): void {
  ;(output.data.verify as Record<string, unknown>).dimensions = {
    review: {
      summary: 'The repair is correct and in scope.',
      evidence: ['src/scoped-a.ts'],
    },
    qa: {
      summary: 'The blast-radius case passes.',
      evidence: ['TP-01 rerun against the repaired fixture'],
    },
  }
}

test('a two-path repair of a remedial verdict runs the verifier alone, which records both dimensions', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')

  failThenRemediate(root, runId, workflow, [
    'src/scoped-a.ts',
    'src/scoped-b.ts',
  ])

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.evidence_workers, undefined)
  assert.deepEqual(invocation.scoped_return?.blast_radius, [
    'src/scoped-a.ts',
    'src/scoped-b.ts',
  ])
  assert.deepEqual(
    invocation.scoped_return?.dimensions.map((dimension) => dimension.role),
    ['review', 'qa'],
  )
  assert.match(invocation.$operator.next_action, /Scoped return visit/u)

  const card = readFileSync(
    path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /### Scoped return visit/u)
  assert.match(card, /#### review dimension/u)
  assert.match(card, /#### qa dimension/u)
  assert.doesNotMatch(card, /### Parallel evidence reports/u)

  const procedurePath = invocation.delegation?.supervisor_procedure_path

  assert.ok(procedurePath)
  assert.match(
    readFileSync(path.join(root, procedurePath), 'utf8'),
    /1a\. Scoped return visit: no evidence worker runs/u,
  )

  // No evidence report exists, and the submission does not ask for one; it
  // asks for the dimension sections instead.
  const missing = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
    [],
    (output) => {
      delete (output.data.verify as Record<string, unknown>).dimensions
    },
  )

  assert.notEqual(missing.record.outcome, 'success')
  assert.match(
    JSON.stringify(missing.record),
    /scoped return visit MUST record data\.verify\.dimensions\.review/u,
  )
  assert.doesNotMatch(
    JSON.stringify(missing.record),
    /EVIDENCE_REPORT_MISSING/u,
  )
})

test('a scoped verify output that records both dimensions advances the run', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')

  failThenRemediate(root, runId, workflow, [
    'src/scoped-a.ts',
    'src/scoped-b.ts',
  ])

  const verified = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
    [],
    withDimensions,
  )

  assert.equal(verified.record.outcome, 'success')
  assert.equal(verified.state.current_stage, 'ship')
})

test('a four-path repair keeps both evidence workers', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')

  failThenRemediate(root, runId, workflow, [
    'src/scoped-a.ts',
    'src/scoped-b.ts',
    'src/scoped-c.ts',
    'src/scoped-d.ts',
  ])

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.scoped_return, undefined)
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review', 'qa'],
  )
})
