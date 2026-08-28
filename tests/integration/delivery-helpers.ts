import assert from 'node:assert/strict'
import path from 'node:path'

import { prepareInvocation, submitOutput } from '../../src/lib/engine.js'
import type {
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../../src/lib/types.js'
import { makeOutput, writeCanonicalDelegation, writeJson } from '../helpers.js'

/** A verify data payload whose verdict stays consistent with a failed stage. */
export function failingVerify(findingId: string): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: findingId,
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

/** Prepare, fill, and submit the current stage's output in one step. */
export function submitStageOutput(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome,
  failedCriterionIds: string[] = [],
  mutate?: (output: StageOutput) => void,
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)
  output.result = result

  for (const criterion of output.criteria) {
    criterion.result = failedCriterionIds.includes(criterion.id)
      ? 'fail'
      : 'pass'
  }

  mutate?.(output)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return submitOutput(root, runId, invocation.output.path)
}
