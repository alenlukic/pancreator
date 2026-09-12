import assert from 'node:assert/strict'
import path from 'node:path'

import { getRunState, prepareInvocation } from '../../src/lib/engine.js'
import { loadWorkflowFile } from '../../src/lib/workflow.js'
import {
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import type {
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../../src/lib/types.js'

export function setInvolvement(root: string, value: unknown): void {
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  config.operator_involvement = value
  writeJson(path.join(root, 'config.json'), config)
}

export function runWorkflow(root: string, runId: string) {
  const state = getRunState(root, runId)

  return loadWorkflowFile(root, path.join(root, state.workflow_snapshot.path))
}

export function submitStage(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome = 'success',
  mutate?: (output: StageOutput) => void,
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)

  output.result = result
  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return {
    invocation,
    submitted: submitAsSupervisor(root, runId, invocation.output.path),
  }
}

/** A verify record whose graded verdict routes the run to remediation. */
export function failingVerifyData(): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: 'VF-INV-1',
        severity: 'blocker',
        source: 'qa',
        statement: 'The workflow fixture does not advance.',
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
      { id: 'AC-01', result: 'fail', evidence: ['fixture'] },
    ],
    remediation_guidance:
      'Rerun the workflow fixture; the run stalls before ship.',
  }
}
