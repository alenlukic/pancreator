import assert from 'node:assert/strict'
import path from 'node:path'

import { prepareInvocation } from '../../src/lib/engine.js'
import type { StageDefinition, StageOutcome } from '../../src/lib/types.js'
import {
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'

import { checksVariant } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

export function checkProfiles(
  staticExit: number,
  fastExit: number,
): Record<string, unknown> {
  return {
    static: {
      probes: [],
      commands: [`node -e "process.exit(${staticExit})"`],
    },
    fast: { probes: [], commands: [`node -e "process.exit(${fastExit})"`] },
  }
}

export function writeChecks(
  root: string,
  staticExit: number,
  fastExit: number,
): void {
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: checkProfiles(staticExit, fastExit),
  })
}

export function checks(
  key: string,
  staticExit: number,
  fastExit: number,
): CheckpointVariant {
  return checksVariant(key, checkProfiles(staticExit, fastExit))
}

export function submitStage(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome = 'success',
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, stage.slug)

  const output = makeOutput(root, invocation, stage, result)

  output.result = result
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return {
    invocation,
    submitted: submitAsSupervisor(root, runId, invocation.output.path),
  }
}
