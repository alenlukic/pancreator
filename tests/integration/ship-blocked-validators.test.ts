import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import type { RequirementValidationResult } from '../../src/lib/types.js'
import { checkpoint, submitStageOutput } from './delivery-helpers.js'

function recordedValidations(
  root: string,
  runId: string,
): Map<string, RequirementValidationResult> {
  const directory = path.dirname(
    resolveRunLayout(root, runId).validation('x.json').absolute,
  )

  return new Map(
    readdirSync(directory).map((entry) => {
      const result = JSON.parse(
        readFileSync(path.join(directory, entry), 'utf8'),
      ) as RequirementValidationResult

      return [result.registry_id, result]
    }),
  )
}

/** Release coordination must preserve the block without inspecting artifacts. */
test('a blocked ship submission awaits operator approval without running release validators', () => {
  const { root, runId, workflow } = checkpoint('delivery@ship-prepared')
  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'ship'),
    'blocked',
    [],
    (output) => {
      output.data = {
        blocked: {
          missing_precondition: 'The run has no fetched main to rebase onto.',
          supplying_command: `pan release sync --worktree w --run ${runId}`,
        },
      }
    },
  )

  assert.equal(submitted.record.outcome, 'blocked')
  assert.deepEqual(submitted.record.evaluation.validation_errors, [])

  const validations = recordedValidations(root, runId)

  assert.equal(validations.has('PR-DESCRIPTION-VALIDATE-001'), false)

  assert.equal(validations.has('RELEASE-VALIDATE-001'), false)
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(submitted.state.pending_action.type, 'operator_approval')
  assert.equal(
    submitted.state.pending_action.type === 'operator_approval' &&
      submitted.state.pending_action.outcome,
    'blocked',
  )
  assert.equal(submitted.state.current_stage, 'ship')
})
