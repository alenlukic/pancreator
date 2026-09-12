import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  createRun,
  makeAttestation,
  makeOutput,
  writeEvidenceReports,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import { submitStageOutput } from './delivery-helpers.js'

test('an infrastructure failure preserves the environment-blocked route', () => {
  const root = createFixture()

  // The environment-blocked route classifies a QA-persona shell gate against
  // a failed baseline of the same profile, and only interior profiles are
  // baselined. The library verify stage carries no repository-check gate, so
  // this fixture's verify stage declares a fast gate of its own.
  const verifyPath = path.join(
    root,
    'library/workflows/delivery/stages/verify.json',
  )
  const verifyDefinition = JSON.parse(readFileSync(verifyPath, 'utf8')) as {
    criteria: Record<string, unknown>[]
  }

  verifyDefinition.criteria.push({
    id: 'verify.qa_infrastructure',
    type: 'shell',
    hard: true,
    statement: 'The QA infrastructure answers the fast profile.',
    command: 'pan repository-check fast',
    timeout_ms: 240000,
  })
  writeJson(verifyPath, verifyDefinition)

  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Verification infrastructure fixture',
  })
  const environmentPath = path.join(root, 'runtime', 'environment.txt')
  // The classifier anchors on artifact shapes, not keyword substrings, so the
  // command emits a real pytest collection error.
  const infrastructureCommand =
    `node -e "const fs=require('node:fs');` +
    `const value=fs.readFileSync('runtime/environment.txt','utf8').trim();` +
    `console.error('ERROR collecting tests/integration '+value);process.exit(1)"`

  writeFileSync(environmentPath, 'baseline\n')
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: ['node -e "process.exit(0)"'] },
      fast: {
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
    [],
    // Compliant read evidence keeps the pre-gate validators green, so the
    // implement gate executes instead of being skipped.
    (output) => attachTargetInstructionEvidence(root, output, ['AGENTS.md']),
  )
  const fastBaseline = getRunState(root, state.run_id)
    .repository_check_baselines?.fast
  assert.ok(fastBaseline)

  writeFileSync(environmentPath, 'current\n')
  setRunStage(root, state.run_id, 'verify', 'Recheck the QA infrastructure.')

  const submitted = submitStageOutput(
    root,
    state.run_id,
    stageBySlug(workflow, 'verify'),
    'success',
  )
  const gate = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.qa_infrastructure',
  )

  assert.equal(gate?.timed_out, false)
  assert.equal(gate?.command, 'pan repository-check fast')
  assert.equal(gate?.environment_blocked, true)
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.pending_action.type, 'operator_decision')
  assert.equal(submitted.state.current_stage, 'verify')
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

  // Submission gates hard on the evidence reports and the verify validator,
  // so this minimal output carries valid verify data. Every other defect
  // below stays advisory.
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

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

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
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(loadWorkflow(root, 'delivery'), 'ship'),
    'success',
    getRunState(root, runId),
  )

  writeJson(path.join(root, invocation.output.path), output)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  // Ship carries an operator gate, so a failure stops for a decision first.
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

test('baseline capture disclosed dirty paths and predecessor provenance', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Baseline provenance fixture',
  })
  const runId = state.run_id

  // Leave an uncommitted prior-run change in the tree.
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
