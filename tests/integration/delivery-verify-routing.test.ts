import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
  setRunStage,
  submitOutput,
  waiveGate,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { StageDefinition, StageOutput } from '../../src/lib/types.js'
import {
  createFixture,
  makeAttestation,
  makeOutput,
  writeCanonicalDelegation,
  writeEvidenceReports,
  writeJson,
} from '../helpers.js'
import { failingVerify, submitStageOutput } from './delivery-helpers.js'

test('a scaled verification timeout preserves the environment-blocked route', () => {
  const root = createFixture()
  const configuredTimeoutMs = 1_000
  const commandDelayMs = 1_500
  const resolvedTimeoutMs = 5_000

  // Under the light level the verify gate runs the fast profile, so the
  // infrastructure scenario and the timeout scaling both route through it.
  for (const [stageFile, criterionId] of [
    ['verify.json', 'verify.full_suite'],
    ['implement.json', 'implement.unit_tests'],
  ] as const) {
    const stagePath = path.join(
      root,
      'library/workflows/delivery/stages',
      stageFile,
    )
    const stageDefinition = JSON.parse(
      readFileSync(stagePath, 'utf8'),
    ) as StageDefinition
    const criterion = stageDefinition.criteria.find(
      (item) => item.id === criterionId,
    )
    assert.ok(criterion)
    criterion.timeout_ms = resolvedTimeoutMs
    writeJson(stagePath, stageDefinition)
  }

  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Verification infrastructure fixture',
  })
  const environmentPath = path.join(root, 'runtime', 'environment.txt')
  const completionPath = path.join(root, 'runtime', 'completed.txt')
  // The emitted diagnostic must carry a genuine infrastructure artifact
  // shape (a pytest collection error): the classifier anchors on shapes, not
  // keyword substrings, so a line merely containing 'timeout' never counts.
  const infrastructureCommand =
    `node -e "const fs=require('node:fs'); ` +
    `setTimeout(() => { const value=fs.readFileSync('runtime/environment.txt','utf8').trim(); ` +
    `fs.appendFileSync('runtime/completed.txt',value+'\\n'); ` +
    `console.error('ERROR collecting tests/integration '+value); process.exit(1) }, ${commandDelayMs})"`

  writeFileSync(environmentPath, 'baseline\n')
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: ['node -e "process.exit(0)"'] },
      fast: {
        timeout_ms: configuredTimeoutMs,
        probes: [],
        commands: [infrastructureCommand],
      },
      full: { probes: [], commands: ['node -e "process.exit(1) /* full */"'] },
      configuration: {
        probes: [],
        commands: ['node -e "process.exit(0) /* configuration */"'],
      },
    },
  })

  setRunStage(root, state.run_id, 'implement', 'Capture infrastructure state.')
  submitStageOutput(
    root,
    state.run_id,
    stageBySlug(workflow, 'implement'),
    'success',
  )
  const fastBaseline = getRunState(root, state.run_id)
    .repository_check_baselines?.fast
  assert.ok(fastBaseline)
  const baselineResult = JSON.parse(
    readFileSync(path.join(root, fastBaseline.artifact_path), 'utf8'),
  ) as {
    result: {
      timeout_ms: number
      results: Array<{
        kind: string
        exit_code: number | null
        stderr: string
        timed_out: boolean
        duration_ms: number
      }>
    }
  }
  const baselineCommand = baselineResult.result.results.find(
    (result) => result.kind === 'command',
  )

  assert.ok(baselineCommand)
  assert.equal(baselineResult.result.timeout_ms, resolvedTimeoutMs)
  assert.ok(baselineCommand.duration_ms > configuredTimeoutMs)
  assert.equal(baselineCommand.timed_out, false)
  assert.equal(baselineCommand.exit_code, 1)
  assert.match(
    baselineCommand.stderr,
    /ERROR collecting tests\/integration baseline/u,
  )
  // Baseline capture plus the implement gate's own fast run.
  assert.equal(readFileSync(completionPath, 'utf8'), 'baseline\nbaseline\n')

  writeFileSync(environmentPath, 'current\n')
  setRunStage(root, state.run_id, 'verify', 'Recheck the QA infrastructure.')

  const submitted = submitStageOutput(
    root,
    state.run_id,
    stageBySlug(workflow, 'verify'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.equal(fullSuite?.timed_out, false)
  assert.equal(fullSuite?.command, 'pan repository-check fast')
  assert.equal(
    readFileSync(completionPath, 'utf8'),
    'baseline\nbaseline\ncurrent\n',
  )
  assert.equal(fullSuite?.environment_blocked, true)
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.pending_action.type, 'operator_decision')
  assert.equal(submitted.state.current_stage, 'verify')
})

test('verify same-reason failure twice pauses for operator_decision', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Same-reason verify fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  setRunStage(root, runId, 'verify', 'Seed verify for same-reason testing.')

  const first = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-SAME-1')
    },
  )

  assert.equal(first.state.status, 'running')
  assert.equal(first.state.current_stage, 'remediate')
  assert.equal(first.state.same_reason_failures?.verify?.repeat_count, 1)

  submitStageOutput(root, runId, remediateStage, 'success')

  const second = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-SAME-2')
    },
  )

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.current_stage, 'verify')
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})

test('different verify failure reasons keep the remediation route', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Different-reason verify fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  setRunStage(
    root,
    runId,
    'verify',
    'Seed verify for different-reason testing.',
  )

  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-DIFF-1')
    },
  )
  submitStageOutput(root, runId, remediateStage, 'success')

  const second = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.tests_correct'],
    (output) => {
      output.data.verify = failingVerify('VF-DIFF-2')
    },
  )

  assert.equal(second.state.status, 'running')
  assert.equal(second.state.current_stage, 'remediate')
  assert.equal(second.state.same_reason_failures?.verify?.repeat_count, 1)
  assert.deepEqual(second.state.same_reason_failures?.verify?.last_signature, [
    'verify.tests_correct',
  ])
})

test('strict superset verify failures trigger same-reason pause', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Superset verify fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  setRunStage(root, runId, 'verify', 'Seed verify for superset testing.')

  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-SUP-1')
    },
  )
  submitStageOutput(root, runId, remediateStage, 'success')

  const second = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met', 'verify.tests_correct'],
    (output) => {
      output.data.verify = failingVerify('VF-SUP-2')
    },
  )

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
})

test('same-reason tracker resets on stage pass, waive-gate, and set-stage', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Same-reason reset fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')
  const failAcceptance = (output: StageOutput, findingId: string): void => {
    output.data.verify = failingVerify(findingId)
  }

  setRunStage(root, runId, 'verify', 'Seed verify for reset testing.')
  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => failAcceptance(output, 'VF-RESET-1'),
  )
  assert.equal(
    getRunState(root, runId).same_reason_failures?.verify?.repeat_count,
    1,
  )

  setRunStage(
    root,
    runId,
    'verify',
    'Operator repair clears same-reason memory.',
  )
  assert.equal(getRunState(root, runId).same_reason_failures?.verify, undefined)

  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => failAcceptance(output, 'VF-RESET-2'),
  )
  submitStageOutput(root, runId, remediateStage, 'success')
  submitStageOutput(root, runId, verifyStage, 'success')
  assert.equal(getRunState(root, runId).same_reason_failures?.verify, undefined)

  setRunStage(root, runId, 'verify', 'Prepare waiver reset coverage.')
  const failed = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => failAcceptance(output, 'VF-RESET-3'),
  )
  assert.equal(failed.state.current_stage, 'remediate')
  submitStageOutput(root, runId, remediateStage, 'success')
  const paused = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => failAcceptance(output, 'VF-RESET-4'),
  )
  assert.equal(paused.state.status, 'paused')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    criterionIds: ['verify.acceptance_met'],
    note: 'Bounded verify miss is isolated and does not block downstream validation.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(getRunState(root, runId).same_reason_failures?.verify, undefined)
})

test('set-stage to remediate clears tracked verify same-reason memory', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Set-stage to remediate reset fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  setRunStage(root, runId, 'verify', 'Seed verify for set-stage reset testing.')
  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-STAGE-1')
    },
  )
  assert.equal(
    getRunState(root, runId).same_reason_failures?.verify?.repeat_count,
    1,
  )
  assert.equal(getRunState(root, runId).current_stage, 'remediate')

  setRunStage(
    root,
    runId,
    'remediate',
    'Operator repair targets remediation and clears verify memory.',
  )
  assert.equal(getRunState(root, runId).same_reason_failures?.verify, undefined)

  submitStageOutput(root, runId, remediateStage, 'success')

  const second = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-STAGE-2')
    },
  )

  assert.equal(second.state.status, 'running')
  assert.equal(second.state.current_stage, 'remediate')
  assert.equal(second.state.same_reason_failures?.verify?.repeat_count, 1)
})

test('ordinary resume preserves same-reason tracker across remediation work', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Resume preserves tracker fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  setRunStage(root, runId, 'verify', 'Seed verify for resume testing.')
  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-RESUME-1')
    },
  )
  assert.equal(
    getRunState(root, runId).same_reason_failures?.verify?.repeat_count,
    1,
  )

  pauseRun(root, runId, 'Operator pauses before remediation continues.')
  resumeRun(
    root,
    runId,
    'remediate',
    'Resume remediation without forgiving verification.',
  )
  assert.equal(
    getRunState(root, runId).same_reason_failures?.verify?.repeat_count,
    1,
  )

  submitStageOutput(root, runId, remediateStage, 'success')

  const second = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-RESUME-2')
    },
  )

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
})

test('governance and artifact defects are advisory before ship and never loop to implementation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Governance warning fixture',
    operatorArtifacts: true,
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Exercise advisory validation routing.')
  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  assert.equal(existsSync(path.join(root, brief.source_path)), true)
  assert.equal(existsSync(path.join(root, brief.rendered_path)), false)

  // Submission still gates hard on the parallel evidence reports and the
  // required verify validator, so the minimal output carries valid verify
  // data; every other defect below stays advisory.
  writeEvidenceReports(root, invocation)
  writeJson(path.join(root, invocation.output.path), {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    invocation_attestation: makeAttestation(invocation),
    data: {
      verify: {
        verdict: 'pass',
        findings: [],
        qa_cases: [
          {
            id: 'TP-01',
            steps: 'Run workflow fixture',
            expected: 'advance',
            actual: 'advance',
            result: 'pass',
          },
        ],
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture'] },
        ],
      },
    },
  })

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'ship')
  assert.equal(submitted.state.status, 'running')
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )
  assert.equal(existsSync(path.join(root, brief.rendered_path)), true)
  assert.equal(existsSync(path.join(root, brief.source_path)), true)
  assert.equal(
    existsSync(
      resolveRunLayout(root, runId).artifactJson(
        'governance-artifact-issues.json',
      ).absolute,
    ),
    true,
  )
})

test('ship owns governance artifact review and pauses instead of looping to implementation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Ship governance fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'ship', 'Exercise ship-stage escalation.')
  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  writeJson(path.join(root, invocation.output.path), {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    invocation_attestation: makeAttestation(invocation),
  })

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  // Ship carries an operator gate, so the failure stops for a decision before it
  // takes the failure route.
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(submitted.state.pending_action.type, 'operator_approval')
  assert.equal(
    submitted.state.pending_action.type === 'operator_approval' &&
      submitted.state.pending_action.outcome,
    'failure',
  )
  assert.equal(submitted.state.current_stage, 'ship')
  assert.notEqual(submitted.state.current_stage, 'implement')
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )

  const decided = decideRun(root, runId, 'approve', 'Accept the failure route.')

  assert.equal(decided.status, 'paused')
  assert.equal(decided.current_stage, 'ship')
})

test('a required implement validator failure blocks the stage transition', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Required validator enforcement fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'implement', 'Exercise required enforcement.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, implementStage)
  const implementation = output.data.implementation as Record<string, unknown>

  // The exact defect of run 63315 record 93_implement-3_c7ba51e2: claimed
  // test files that do not exist. DEV-001 declares the claims validator
  // required with failure_route stage_failure, so the submit MUST fail the
  // stage instead of advancing to verification with a governance warning.
  implementation.tests_added = [
    'tests/unit/tools/custom_dashboard/test_source_citations.py::test_accepts_valid_shape',
  ]
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.notEqual(submitted.state.current_stage, 'verify')
  assert.match(
    submitted.state.stage_history.at(-1)?.validation_errors.join('\n') ?? '',
    /IMPLEMENTATION-CLAIMS-VALIDATE-001/u,
  )
})

test('baseline capture disclosed dirty paths and predecessor provenance', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Baseline provenance fixture',
  })
  const runId = state.run_id

  // Leave uncommitted prior-run changes in the tree, as run 63316 left the
  // lineage_loader type error for run 63315 to inherit.
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true // inherited edit\n',
  )

  const snapshot = gitWorkspaceSnapshot(root)
  const predecessorDir = path.join(
    root,
    'runtime/logs/workflows/00000_predecessor',
  )

  writeJson(path.join(predecessorDir, 'state.json'), {
    schema_version: 1,
    run_id: '00000_predecessor',
    workspace_root: '.',
    stage_history: [
      {
        stage: 'implement',
        attempt: 1,
        invocation_id: 'implement-1-prior',
        output_path: 'x',
        outcome: 'success',
        submitted_at: '2026-08-24T00:00:00.000Z',
        workspace_fingerprint: snapshot.fingerprint,
        validation_errors: [],
        deterministic: [],
      },
    ],
  })
  setRunStage(root, runId, 'implement', 'Capture a dirty-tree baseline.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const pointer = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(pointer)

  const artifact = JSON.parse(
    readFileSync(path.join(root, pointer.artifact_path), 'utf8'),
  ) as {
    workspace_dirty_paths?: string[]
    workspace_dirty_path_count?: number
    predecessor_run_id?: string
  }

  assert.ok(artifact.workspace_dirty_paths?.includes('src/base.ts'))
  assert.ok((artifact.workspace_dirty_path_count ?? 0) >= 1)
  assert.equal(artifact.predecessor_run_id, '00000_predecessor')
})
