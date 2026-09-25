import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import {
  readFastWallSeries,
  TARGET_FAST_LANE,
} from '../../src/lib/fast-wall-series.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
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

test('an embedded target sets its empty fast-wall ceiling from the first passing baseline', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const project = JSON.parse(readFileSync(configPath, 'utf8')) as {
    fast_wall: Record<string, unknown>
  } & Record<string, unknown>

  writeJson(configPath, {
    ...project,
    installation_mode: 'embedded',
    workspace_root: '.',
    fast_wall: { ...project.fast_wall, ceiling_ms: null },
  })
  syncCursorProjection(root, { write: true })
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [PASS] },
      fast: {
        probes: [],
        commands: ['node -e "setTimeout(() => {}, 300) /* fast */"'],
      },
      full: { probes: [], commands: ['node -e "process.exit(0) /* full */"'] },
      configuration: {
        probes: [],
        commands: ['node -e "process.exit(0) /* configuration */"'],
      },
    },
  })

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Embedded fast-wall calibration',
  })

  setRunStage(root, state.run_id, 'implement', 'Capture the baseline.')
  prepareInvocation(root, state.run_id)

  const calibrated = (
    JSON.parse(readFileSync(configPath, 'utf8')) as {
      fast_wall: { ceiling_ms: number; calibrated_at: string }
    }
  ).fast_wall
  const [row] = readFastWallSeries(root).records

  assert.ok(row, 'the baseline recorded one target fast-lane row')
  assert.equal(row.lane, TARGET_FAST_LANE)
  assert.equal(row.phase, 'baseline')
  assert.equal(row.run_id, state.run_id)
  assert.equal(
    calibrated.ceiling_ms,
    Math.ceil((row.wall_clock_ms * 1.5) / 1000) * 1000,
  )
  assert.ok(Date.parse(calibrated.calibrated_at) > 0)
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
