import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import { checkpoint, checksVariant, PASS } from './delivery-helpers.js'

test('a failed environment probe pauses before source-stage delegation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Environment probe fixture',
  })

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        environment_probes: ['node -e "process.exit(17)"'],
        probes: [],
        commands: ['node -e "process.exit(0)"'],
      },
      fast: { probes: [], commands: ['node -e "process.exit(0) /* fast */"'] },
      full: { probes: [], commands: ['node -e "process.exit(0) /* full */"'] },
      configuration: {
        probes: [],
        commands: ['node -e "process.exit(0) /* configuration */"'],
      },
    },
  })
  setRunStage(root, state.run_id, 'implement', 'Check the environment first.')

  const prepared = prepareInvocation(root, state.run_id)

  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.equal(prepared.state.pending_action.type, 'operator_decision')
  assert.match(prepared.state.pause_reason ?? '', /environment probe failed/u)
  assert.equal(prepared.state.repository_check_baselines, undefined)

  // The paused run must stay loadable. The state digest must match the state
  // artifact after the run clears the baseline pointer.
  const reloaded = getRunState(root, state.run_id)

  assert.equal(reloaded.status, 'paused')
  assert.equal(reloaded.revision, prepared.state.revision)
})

test('new repository-check diagnostics still block implementation', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=static-echoes-src/base.ts', {
      static: {
        probes: [],
        commands: [
          `node -e "const fs=require('node:fs'); console.error(fs.readFileSync('src/base.ts','utf8').trim()); process.exit(1)"`,
        ],
      },
      fast: { probes: [], commands: [PASS] },
    }),
  )
  const implementStage = stageBySlug(workflow, 'implement')

  assert.ok(invocation)
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  const output = makeOutput(root, invocation, implementStage)
  const implementation = output.data.implementation as Record<string, unknown>
  implementation.changed_files = ['src/base.ts']
  // Compliant read evidence keeps every pre-gate validator green, so the gate
  // itself decides this stage; a validator rejection would skip the gates.
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.equal(staticResult?.passed, false)
  assert.match(staticResult?.explanation ?? '', /introduced a new failure/u)
  assert.equal(staticResult?.repository_check_delta?.new.length, 1)
  assert.match(
    staticResult?.repository_check_delta?.new[0]?.diagnostic ?? '',
    /export const base = false/u,
  )
})

test('a repository-check gate credits an inherited failure the stage fixed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Inherited failure repair fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "const fs=require('node:fs'); const body=fs.readFileSync('src/base.ts','utf8'); if (body.includes('broken')) { console.error('inherited lint failure in src/base.ts'); process.exit(1) }"`,
        ],
      },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = broken\n')
  setRunStage(root, runId, 'implement', 'Baseline an inherited lint failure.')

  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.static?.status,
    'failed',
  )

  const output = makeOutput(root, first, implementStage)
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, first.output.path), output)
  writeCanonicalDelegation(root, first)

  const inherited = submitAsSupervisor(root, runId, first.output.path)
  const beforeRepair = inherited.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(beforeRepair?.passed, true)
  assert.equal(beforeRepair?.preexisting_failure, true)

  // Credit for the repair must not need an operator waiver.
  setRunStage(root, runId, 'implement', 'Repair the inherited lint failure.')
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = true\n')

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)

  const repaired = makeOutput(root, second, implementStage)
  const implementation = repaired.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/base.ts']
  attachTargetInstructionEvidence(root, repaired, ['AGENTS.md'])
  writeJson(path.join(root, second.output.path), repaired)
  writeCanonicalDelegation(root, second)

  const submitted = submitAsSupervisor(root, runId, second.output.path)
  const afterRepair = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.equal(afterRepair?.passed, true)
  assert.equal(afterRepair?.preexisting_failure, undefined)
  assert.equal(afterRepair?.repository_check_delta?.new.length, 0)
  assert.ok(
    afterRepair?.repository_check_delta?.fixed.some((diagnostic) =>
      /inherited lint failure/u.test(diagnostic.diagnostic),
    ),
    'the repaired diagnostic must be recorded as fixed',
  )
  assert.deepEqual(getRunState(root, runId).operator_gate_waivers ?? [], [])
})
