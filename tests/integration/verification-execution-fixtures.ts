import assert from 'node:assert/strict'
import { prepareInvocation } from '../../src/lib/engine/prepare.js'
import { resolveWriteSandbox } from '../../src/lib/executors/write-sandbox.js'
import type { VerificationExecutionOperation } from '../../src/lib/types/verification-execution.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  submitStageOutput,
  type CheckpointVariant,
} from './delivery-helpers.js'

export function prepared(
  operations: VerificationExecutionOperation[],
  variant?: CheckpointVariant,
) {
  const clone = checkpoint('delivery@implement-prepared', variant)
  const implemented = submitStageOutput(
    clone.root,
    clone.runId,
    stageBySlug(clone.workflow, 'implement'),
    'success',
    [],
    (output) => {
      output.data.verification_execution_operations = operations
    },
  )
  assert.equal(
    implemented.record.outcome,
    'success',
    JSON.stringify(implemented.record.evaluation),
  )
  const result = prepareInvocation(clone.root, clone.runId)
  assert.ok(result.invocation?.verification_execution)
  return { ...clone, state: result.state, invocation: result.invocation }
}

export function enforced(root: string): boolean {
  return resolveWriteSandbox([root], { strict: true }).mode !== 'none'
}
