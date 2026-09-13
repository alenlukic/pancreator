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

/**
 * A blocked ship submission wrote no release packet and no pull-request copy,
 * so the validators that read them have nothing to judge. Failing them buried
 * the block itself under one failure per absent release field.
 */
test('a blocked ship submission reports its release validators as not applicable', () => {
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

  for (const registryId of [
    'RELEASE-VALIDATE-001',
    'PR-DESCRIPTION-VALIDATE-001',
  ]) {
    const result = validations.get(registryId)

    assert.ok(result, `${registryId} recorded no result`)
    assert.equal(result.status, 'not_applicable')
    assert.equal(result.exit_code, 0)
    assert.match(
      result.issues[0]?.message ?? '',
      /reported blocked, so it produced no target/u,
    )
  }
})
