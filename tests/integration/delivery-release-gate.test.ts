import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  resumeRun,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  assertNoShellGate,
  checkpoint,
  checksVariant,
  failingVerify,
  fullFailsUntil,
  fullRuns,
  PASS,
  submitStageOutput,
} from './delivery-helpers.js'

// The full command writes a fixture profile at the reporter's target. Every
// other profile records a leak marker when it sees the variable at all.
const PROFILE_FULL_COMMAND =
  `node -e "const fs=require('node:fs');const t=process.env.PAN_TEST_PROFILE;` +
  `if(!t){process.exit(9)};fs.writeFileSync(t,JSON.stringify({schema_version:1,` +
  `lane:'unit',recorded_at:'x',test_count:3,pass_count:3,fail_count:0,` +
  `wall_clock_ms:1200,files:[{file:'tests/unit/a.test.ts',duration_ms:800,` +
  `test_count:3,pass_count:3,fail_count:0}],slowest_tests:[{file:'tests/unit/a.test.ts',` +
  `name:'alpha',duration_ms:500}]}));fs.appendFileSync('runtime/full-ran.txt','x')"`
const PROFILE_LEAK_COMMAND =
  `node -e "if(process.env.PAN_TEST_PROFILE){require('node:fs')` +
  `.appendFileSync('runtime/profile-leak.txt','x')}"`
const PROFILE_FAST_COMMAND = `node -e "require('node:fs').appendFileSync('runtime/fast-refresh.txt','x')"`

test('a remediate to verify return never runs full; the ship release gate runs it exactly once', () => {
  const { root, runId, workflow, state } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-marker', {
      static: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
      fast: {
        probes: [],
        commands: [PROFILE_LEAK_COMMAND, PROFILE_FAST_COMMAND],
      },
      full: { probes: [], commands: [PROFILE_FULL_COMMAND] },
      configuration: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
    }),
  )
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  assert.equal(state.verification?.level, 'light')

  // The implement loop baselines the interior profiles only.
  assert.ok(state.repository_check_baselines?.fast)
  assert.ok(state.repository_check_baselines?.static)
  assert.equal(state.repository_check_baselines?.full, undefined)
  assert.equal(state.repository_check_baselines?.configuration, undefined)
  assert.equal(fullRuns(root), 0)
  assert.equal(existsSync(path.join(root, 'runtime/profile-leak.txt')), false)
  const fastBeforeRemediation = readFileSync(
    path.join(root, 'runtime/fast-refresh.txt'),
    'utf8',
  ).length

  // A failing verdict forwards to remediate without running full.
  const failed = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-ONCE-1')
    },
  )

  assert.equal(failed.state.current_stage, 'remediate')
  assert.equal(fullRuns(root), 0)

  // A remediation that a verify verdict routed returns to verify. Its
  // submission gate runs static only, never full.
  const remediated = submitStageOutput(root, runId, remediateStage, 'success')

  assert.equal(remediated.record.outcome, 'success')
  assert.equal(remediated.state.current_stage, 'verify')
  assert.deepEqual(
    remediated.record.evaluation.deterministic
      .filter((item) => item.type === 'shell')
      .map((item) => item.command),
    ['pan repository-check static'],
  )
  assert.equal(fullRuns(root), 0)
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.full,
    undefined,
  )

  // Preparing the return visit refreshes stale fast evidence before any
  // evidence worker is delegated. Static is already current from remediation.
  const verified = submitStageOutput(root, runId, verifyStage, 'success')

  assert.equal(
    readFileSync(path.join(root, 'runtime/fast-refresh.txt'), 'utf8').length,
    fastBeforeRemediation + 1,
  )
  assert.equal(verified.record.outcome, 'success')
  assert.equal(verified.state.current_stage, 'ship')
  assertNoShellGate(verified.record.evaluation.deterministic)
  assert.equal(fullRuns(root), 0)

  // Ship entry runs full once and hands its suite profile to the card.
  const progress: string[] = []
  const ship = prepareInvocation(root, runId, {
    onProgress: (message) => progress.push(message),
  }).invocation

  assert.ok(ship)
  assert.ok(
    progress.some((message) =>
      /running entry gate ship\.full_suite .*timeout 1200000ms/u.test(message),
    ),
  )
  assert.equal(fullRuns(root), 1)
  assert.equal(existsSync(path.join(root, 'runtime/profile-leak.txt')), false)

  const gate = getRunState(root, runId).entry_gates?.ship
  const profilePath = gate?.last_result.suite_profile_path

  assert.ok(gate)
  assert.equal(gate.last_result.passed, true)
  assert.ok(profilePath)
  assert.ok(existsSync(path.join(root, profilePath)))
  assert.equal(ship.suite_profile?.profile_path, profilePath)
  assert.equal(ship.suite_profile?.cached, false)
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.full,
    undefined,
  )

  // The ship submission carries the entry-gate result instead of rerunning.
  // The verify failure this run replayed recorded a governance issue, so the
  // release output has to disposition it before the gate can decide anything.
  const recorded = getRunState(root, runId).governance_artifact_issues ?? []
  const shipped = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'ship'),
    'success',
    [],
    (output) => {
      const release = output.data.release as {
        governance_artifact_review: { issues_reviewed: string[] }
      }

      release.governance_artifact_review.issues_reviewed = recorded.map(
        (item) => item.issue_id,
      )
    },
  )
  const fullSuite = shipped.record.evaluation.deterministic.find(
    (item) => item.id === 'ship.full_suite',
  )

  assert.ok(fullSuite)
  assert.equal(fullSuite.entry_gate, true)
  assert.equal(fullSuite.passed, true)
  assert.equal(fullSuite.evidence_path, gate.last_result.evidence_path)
  assert.equal(shipped.record.outcome, 'success')
  assert.equal(fullRuns(root), 1)
})

// The card's return marker and the harness refresh answered "is this a
// return visit" with different predicates. A verify that blocked after the
// remediation pauses the run; on resume the brief still marked the return
// and forbade profile execution, while prepare refreshed nothing, so the
// verifier was told to cite evidence the harness had not retaken.
test('a verify that blocked after remediation still refreshes stale evidence on resume', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-marker', {
      static: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
      fast: {
        probes: [],
        commands: [PROFILE_LEAK_COMMAND, PROFILE_FAST_COMMAND],
      },
      full: { probes: [], commands: [PROFILE_FULL_COMMAND] },
      configuration: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
    }),
  )
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')
  const fastRuns = () =>
    readFileSync(path.join(root, 'runtime/fast-refresh.txt'), 'utf8').length

  submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-BLOCKED-1')
    },
  )
  submitStageOutput(root, runId, remediateStage, 'success')

  // A `blocked` verify owes its blocking reason instead of a verdict, and
  // skips the criteria it never reached.
  submitStageOutput(root, runId, verifyStage, 'blocked', [], (output) => {
    output.criteria = output.criteria.map((criterion) => ({
      ...criterion,
      result: 'skipped',
      explanation: 'Verification lacks the required evidence.',
    }))
    output.data.verify = {
      blocking_reason: 'An evidence worker returned no report.',
      missing_evidence_paths: ['qa-evidence.md'],
    }
  })

  const blocked = getRunState(root, runId)

  // That submission's own prepare was the first return, and it refreshed.
  const afterBlockedVerify = fastRuns()

  assert.equal(blocked.stage_history.at(-1)?.outcome, 'blocked')
  assert.equal(blocked.status, 'paused')

  // The operator resumes the same stage. The last history entry is now the
  // blocked verify rather than the remediation, which is the shape that
  // skipped the refresh, and the workspace has moved since that refresh.
  resumeRun(root, runId, 'verify')
  writeFileSync(path.join(root, 'src', 'retry.ts'), 'export const r = 1\n')

  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)
  assert.ok(
    prepared.invocation.inputs.remediation_return,
    'the card still marks the return after a blocked retry',
  )
  assert.equal(
    fastRuns(),
    afterBlockedVerify + 1,
    'the harness refreshes the interior profile the moved workspace staled',
  )
  assert.equal(fullRuns(root), 0)
})

test('thorough verification runs full at the ship release gate on its own result and routes a failure to remediate, which returns through verify', () => {
  const { root, runId, state, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant(
      'verification=thorough,checks=full-fails-once',
      {
        static: { probes: [], commands: [PASS] },
        fast: { probes: [], commands: [PASS] },
        full: { probes: [], commands: [fullFailsUntil(1)] },
        configuration: { probes: [], commands: [PASS] },
      },
      { verification: 'thorough' },
    ),
  )

  // Thorough opts into absolute judgment, so the run never baselines full.
  assert.equal(state.repository_check_baselines?.full, undefined)

  const verified = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
  )

  assert.equal(verified.record.outcome, 'success')
  assert.equal(verified.state.current_stage, 'ship')
  assert.equal(fullRuns(root), 0)

  // The release gate fails on its own result and routes to remediate.
  const routed = prepareInvocation(root, runId)

  assert.equal(routed.invocation, null)
  assert.equal(fullRuns(root), 1)
  assert.equal(routed.state.status, 'running')
  assert.equal(routed.state.current_stage, 'remediate')

  const gate = routed.state.entry_gates?.ship

  assert.ok(gate)
  assert.equal(gate.failures, 1)
  // The gate stage reads verify evidence, so the repair returns through its
  // own success path rather than directly to the gate.
  assert.equal(gate.routed_to, undefined)
  assert.equal(gate.repair_stage, 'remediate')
  assert.equal(gate.last_result.passed, false)
  assert.equal(gate.last_result.preexisting_failure, undefined)
  assert.equal(gate.last_result.command, 'pan repository-check full')
  assert.equal(routed.state.verification?.level, 'thorough')
  assert.ok(gate.last_result.evidence_path)

  // The remediate card carries the failed gate evidence as a required input.
  const remediate = prepareInvocation(root, runId).invocation

  assert.ok(remediate)
  assert.equal(remediate.stage.slug, 'remediate')
  assert.ok(
    remediate.inputs.references.some(
      (reference) =>
        reference.path === gate.last_result.evidence_path &&
        reference.retrieval === 'required',
    ),
    JSON.stringify(remediate.inputs.references),
  )

  // A remediation that the release gate routed returns through verify, which
  // retakes its evidence at the repaired workspace before ship runs full
  // again.
  const remediated = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'remediate'),
    'success',
  )

  assert.equal(remediated.record.outcome, 'success')
  assert.equal(remediated.state.current_stage, 'verify')
  assert.equal(fullRuns(root), 1)

  const reverified = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
  )

  assert.equal(reverified.state.current_stage, 'ship')
  assert.equal(fullRuns(root), 1)

  const ship = prepareInvocation(root, runId)

  assert.ok(ship.invocation)
  assert.equal(fullRuns(root), 2)
  assert.equal(ship.state.entry_gates?.ship?.failures, 0)
  assert.equal(ship.state.entry_gates?.ship?.routed_to, undefined)
  assert.equal(ship.state.entry_gates?.ship?.last_result.passed, true)
})

test('delivery-chunk remediation gates configuration', () => {
  const remediate = stageBySlug(
    loadWorkflow(process.cwd(), 'delivery-chunk'),
    'remediate',
  )
  const commands = remediate.criteria
    .filter((criterion) => criterion.type === 'shell')
    .map((criterion) => criterion.command)

  assert.deepEqual(commands, [
    'pan repository-check static',
    'pan repository-check configuration',
  ])
})
