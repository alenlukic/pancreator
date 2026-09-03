import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import {
  checkpoint,
  checksVariant,
  failingVerify,
  submitStageOutput,
} from './delivery-helpers.js'

const PASS = `node -e "process.exit(0)"`

const GREEN_CHECKS = checksVariant('checks=green', {
  static: { probes: [], commands: [PASS] },
  fast: { probes: [], commands: [PASS] },
  full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
  configuration: { probes: [], commands: [PASS] },
})

test('a failing verify verdict routes without executing the full suite', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  const failed = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-GATE-1')
    },
  )

  assert.equal(failed.record.outcome, 'failure')
  assert.equal(failed.state.current_stage, 'remediate')

  const suite = failed.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.ok(suite)
  assert.equal(suite.skipped, true)
  assert.equal(suite.passed, true)
  assert.equal(suite.exit_code, undefined)
  assert.equal(suite.evidence_path, undefined)
  assert.match(suite.explanation ?? '', /the stage reported result 'failure'/u)

  // The scope state criterion still evaluates when every shell gate is skipped.
  const scope = failed.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.skipped, undefined)
})

test('an unevaluated verify criterion blocks success before the full suite', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  const submitted = submitStageOutput(
    root,
    runId,
    verifyStage,
    'success',
    [],
    (output) => {
      const criterion = output.criteria.find(
        (item) => item.id === 'verify.tests_correct',
      )

      assert.ok(criterion)
      criterion.result = 'unevaluated'
    },
  )
  const suite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'remediate')
  assert.ok(suite)
  assert.equal(suite.skipped, true)
  assert.equal(suite.exit_code, undefined)
  assert.match(
    submitted.record.evaluation.validation_errors.join('\n'),
    /Criterion 'verify\.tests_correct' remains unevaluated/u,
  )
  assert.doesNotMatch(
    submitted.record.evaluation.validation_errors.join('\n'),
    /criteria '.+' is unevaluated;/u,
  )
})

test('a blocked verify submission pauses without product-field errors', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  const submitted = submitStageOutput(
    root,
    runId,
    verifyStage,
    'blocked',
    [],
    (output) => {
      output.criteria = output.criteria.map((criterion) => ({
        ...criterion,
        result: 'skipped',
        explanation: 'Verification lacks the required evidence.',
      }))
      output.data.verify = {
        blocking_reason: 'Required evidence reports are missing.',
        missing_evidence_paths: ['review-evidence.md', 'qa-evidence.md'],
      }
    },
  )
  const suite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.equal(submitted.record.outcome, 'blocked')
  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.deepEqual(submitted.record.evaluation.validation_errors, [])
  assert.ok(suite)
  assert.equal(suite.skipped, true)
  assert.equal(suite.exit_code, undefined)
})

test('a failed hard self-criterion skips shell gates on a declared success', () => {
  const { root, runId, workflow } = checkpoint('delivery@implement-prepared')
  const implementStage = stageBySlug(workflow, 'implement')

  const submitted = submitStageOutput(root, runId, implementStage, 'success', [
    'implement.acceptance_claimed',
  ])

  assert.equal(submitted.record.outcome, 'failure')

  const shellResults = submitted.record.evaluation.deterministic.filter(
    (item) => item.type === 'shell',
  )

  assert.ok(shellResults.length >= 2)
  for (const result of shellResults) {
    assert.equal(result.skipped, true)
    assert.equal(result.passed, true)
    assert.equal(result.exit_code, undefined)
    assert.match(
      result.explanation ?? '',
      /hard criterion 'implement\.acceptance_claimed' was self-evaluated as failed/u,
    )
  }
})

test('a failed read attestation skips shell gates before executing them', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )
  const implementStage = stageBySlug(workflow, 'implement')

  assert.ok(invocation)

  const output = makeOutput(root, invocation, implementStage)

  assert.ok(output.invocation_attestation)
  assert.ok(output.invocation_attestation.status === 'read')
  output.invocation_attestation.contract_sha256 = '0'.repeat(64)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')

  const shellResults = submitted.record.evaluation.deterministic.filter(
    (item) => item.type === 'shell',
  )

  assert.ok(shellResults.length >= 2)
  for (const result of shellResults) {
    assert.equal(result.skipped, true)
    assert.match(
      result.explanation ?? '',
      /the invocation read attestation failed/u,
    )
  }
})

test('implementation same-reason failure twice pauses before a third attempt', () => {
  const {
    root,
    runId,
    state: first,
    workflow,
  } = checkpoint('delivery@implement-failed-once')
  const implementStage = stageBySlug(workflow, 'implement')

  assert.equal(first.status, 'running')
  assert.equal(first.current_stage, 'implement')
  assert.equal(first.same_reason_failures?.implement?.repeat_count, 1)

  const second = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.attempts.implement, 2)
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})

test('a retry may submit a merge-patch revision instead of the whole document', () => {
  const {
    root,
    runId,
    state: first,
    workflow,
  } = checkpoint('delivery@implement-failed-once')
  const implementStage = stageBySlug(workflow, 'implement')
  const firstHistory = first.stage_history[0]
  const firstInvocationId = firstHistory.invocation_id
  const firstOutput = JSON.parse(
    readFileSync(path.join(root, firstHistory.output_path), 'utf8'),
  ) as Record<string, Record<string, unknown>>

  assert.equal(firstHistory.outcome, 'failure')
  assert.equal(first.current_stage, 'implement')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.attempt, 2)
  const card = readFileSync(
    path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /"revises"/u)
  assert.ok(card.includes(firstInvocationId))

  const template = makeOutput(root, invocation, implementStage)
  const patch = {
    revises: firstInvocationId,
    patch: {
      invocation_id: invocation.invocation_id,
      result: 'success',
      $operator: template.$operator,
      artifacts: template.artifacts,
      criteria: template.criteria,
      invocation_attestation: template.invocation_attestation,
      data: {
        implementation: {
          remediation: [
            {
              cause: 'Acceptance claim lacked evidence',
              action: 'Mapped every criterion to fixture evidence',
              evidence: ['request.md'],
            },
          ],
        },
      },
    },
  }

  writeJson(path.join(root, invocation.output.path), patch)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')

  const historyItem = submitted.state.stage_history.find(
    (item) => item.invocation_id === invocation.invocation_id,
  )

  assert.equal(historyItem?.revised_from, firstInvocationId)

  const merged = JSON.parse(
    readFileSync(path.join(root, invocation.output.path), 'utf8'),
  ) as Record<string, Record<string, unknown>>

  assert.equal(
    merged.invocation_id as unknown as string,
    invocation.invocation_id,
  )
  assert.equal(merged.result as unknown as string, 'success')
  assert.deepEqual(
    (merged.data.implementation as Record<string, unknown>).changed_files,
    (firstOutput.data.implementation as Record<string, unknown>).changed_files,
  )
  assert.equal(
    (
      (merged.data.implementation as Record<string, unknown>)
        .remediation as unknown[]
    ).length,
    1,
  )

  const replay = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(replay.idempotent, true)
})

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

const FULL_MARKER_COMMAND = `node -e "require('node:fs').appendFileSync('runtime/full-ran.txt','x'); process.exit(0)"`
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

function fullRuns(root: string): number {
  const marker = path.join(root, 'runtime', 'full-ran.txt')

  return existsSync(marker) ? readFileSync(marker, 'utf8').length : 0
}

test('the default light level runs full once as the verify gate on a passing verdict and never baselines it', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Light verification fixture',
  })
  const runId = state.run_id

  assert.equal(state.verification?.level, 'light')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [FULL_MARKER_COMMAND] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })

  setRunStage(root, runId, 'implement', 'Baseline the implement-loop profiles.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  // The implement loop never touches full: no baseline, no interior gate.
  const baselined = getRunState(root, runId).repository_check_baselines
  assert.ok(baselined?.fast)
  assert.ok(baselined?.static)
  assert.equal(baselined?.full, undefined)
  assert.equal(baselined?.configuration, undefined)
  assert.equal(fullRuns(root), 0)

  setRunStage(root, runId, 'verify', 'Run verification under the light level.')
  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.ok(fullSuite)
  assert.equal(fullSuite.command, 'pan repository-check full')
  assert.equal(fullSuite.verification_level, 'light')
  assert.equal(fullSuite.passed, true)
  assert.equal(fullSuite.cached, undefined)
  assert.equal(fullSuite.preexisting_failure, undefined)
  assert.equal(submitted.record.outcome, 'success')
  assert.equal(fullRuns(root), 1)
})

test('a remediate to verify return executes the full profile exactly once', () => {
  const { root, runId, workflow, state } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-marker', {
      static: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
      fast: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
      full: { probes: [], commands: [PROFILE_FULL_COMMAND] },
      configuration: { probes: [], commands: [PROFILE_LEAK_COMMAND] },
    }),
  )
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  assert.equal(state.verification?.level, 'light')
  assert.equal(state.repository_check_baselines?.full, undefined)
  assert.equal(fullRuns(root), 0)
  assert.equal(existsSync(path.join(root, 'runtime/profile-leak.txt')), false)

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

  // Remediation success runs full once, as the remediate submission gate.
  const remediated = submitStageOutput(root, runId, remediateStage, 'success')
  const remediateGate = remediated.record.evaluation.deterministic.find(
    (item) => item.id === 'remediate.full_suite',
  )

  assert.equal(remediated.record.outcome, 'success')
  assert.equal(remediated.state.current_stage, 'verify')
  assert.ok(remediateGate)
  assert.equal(remediateGate.command, 'pan repository-check full')
  assert.equal(remediateGate.passed, true)
  assert.equal(remediateGate.cached, undefined)
  const profilePath = remediateGate.suite_profile_path

  assert.ok(profilePath)
  assert.ok(existsSync(path.join(root, profilePath)))
  assert.equal(existsSync(path.join(root, 'runtime/profile-leak.txt')), false)
  assert.equal(
    remediated.record.evaluation.deterministic.some(
      (item) => item.id === 'implement.unit_tests',
    ),
    false,
  )
  assert.equal(fullRuns(root), 1)
  // The source-allowed remediate stage still never baselines full.
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.full,
    undefined,
  )

  // Verify is read-only, so the fingerprint is unchanged and the verify gate
  // accepts the recorded remediate pass instead of running full again.
  const verified = submitStageOutput(root, runId, verifyStage, 'success')
  const verifyGate = verified.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.ok(verifyGate)
  assert.equal(verifyGate.command, 'pan repository-check full')
  assert.equal(verifyGate.passed, true)
  assert.equal(verifyGate.cached, true)
  assert.equal(verifyGate.suite_profile_path, profilePath)
  assert.match(verifyGate.explanation ?? '', /cached clean pass/u)
  assert.equal(verified.record.outcome, 'success')
  assert.equal(verified.state.current_stage, 'ship')

  const ship = prepareInvocation(root, runId).invocation

  assert.ok(ship)
  assert.equal(ship.suite_profile?.profile_path, profilePath)
  assert.equal(ship.suite_profile?.cached, true)
  assert.equal(fullRuns(root), 1)
})

test('thorough verification runs full at verify on its own result', () => {
  const { root, runId, state, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant(
      'verification=thorough,checks=full-fails',
      {
        static: { probes: [], commands: [PASS] },
        fast: { probes: [], commands: [PASS] },
        full: { probes: [], commands: [`node -e "process.exit(1)"`] },
        configuration: { probes: [], commands: [PASS] },
      },
      { verification: 'thorough' },
    ),
  )

  // Thorough opts into absolute judgment, so the run never baselines full.
  assert.equal(state.repository_check_baselines?.full, undefined)

  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'verify.full_suite',
  )

  assert.ok(fullSuite)
  assert.equal(fullSuite.command, 'pan repository-check full')
  assert.equal(fullSuite.passed, false)
  assert.equal(fullSuite.preexisting_failure, undefined)
  assert.equal(submitted.record.outcome, 'failure')
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

test('a missing baseline artifact pauses the run before delegation', () => {
  const { root, runId, state } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const baseline = state.repository_check_baselines?.static

  assert.ok(baseline)
  rmSync(path.join(root, baseline.artifact_path))

  setRunStage(root, runId, 'implement', 'Re-enter implementation without one.')

  const prepared = prepareInvocation(root, runId)

  // The worker cannot influence a missing baseline, so the run pauses and
  // does not spend the stage attempt.
  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.equal(prepared.state.pending_action.type, 'operator_decision')
  assert.match(prepared.state.pause_reason ?? '', /cannot be delegated/u)
  assert.match(prepared.state.pause_reason ?? '', /implement\.lint/u)
  assert.match(
    prepared.state.pause_reason ?? '',
    /baseline artifact is missing/u,
  )
})

test('a wiped baseline map degrades gates to absolute judgment without recapture', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const implementStage = stageBySlug(workflow, 'implement')
  const statePath = resolveRunLayout(root, runId).state.absolute
  const damagedState = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
    string,
    unknown
  >

  damagedState.repository_check_baselines = {}
  writeJson(statePath, damagedState)
  setRunStage(root, runId, 'implement', 'Re-enter with no baseline pointers.')

  // The run captures no baseline after implementation. An absent pointer
  // degrades the gate to its own result instead of a closed failure.
  const submitted = submitStageOutput(root, runId, implementStage, 'success')
  const staticResult = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.baseline_evidence_path, undefined)
  assert.deepEqual(getRunState(root, runId).repository_check_baselines, {})
})

test('a repository-check gate fails closed when its baseline disappears', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Fail-closed baseline fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Baseline a green static profile.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)

  const output = makeOutput(root, invocation, implementStage)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  rmSync(path.join(root, baseline.artifact_path))

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  // A green exit code is not proof of parity when the gate cannot compare.
  assert.equal(staticResult?.passed, false)
  assert.match(staticResult?.explanation ?? '', /baseline artifact is missing/u)
  assert.equal(submitted.record.outcome, 'failure')
})

test('an incompatible baseline artifact pauses the run before delegation', () => {
  const { root, runId, state } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const baseline = state.repository_check_baselines?.static

  assert.ok(baseline)
  writeJson(path.join(root, baseline.artifact_path), {
    schema_version: 1,
    profile: 'static',
    result: { status: 'failed' },
  })

  setRunStage(root, runId, 'implement', 'Re-enter implementation.')

  const prepared = prepareInvocation(root, runId)

  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.match(prepared.state.pause_reason ?? '', /incompatible with its gate/u)
})

test('a claims omission rejects the submission before any shell gate executes', () => {
  const markerDir = mkdtempSync(path.join(tmpdir(), 'pancreator-gate-marker-'))
  const marker = path.join(markerDir, 'gate-executed')
  const writeMarker = (profile: string): string =>
    `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, '${profile}')"`
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=marker-on-execution', {
      static: { probes: [], commands: [writeMarker('static')] },
      fast: { probes: [], commands: [writeMarker('fast')] },
    }),
  )

  assert.ok(invocation)
  // Baselines ran the profiles before implementation; only a gate at submit
  // may write the marker from here on.
  rmSync(marker, { force: true })

  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeFileSync(path.join(root, 'src/extra.ts'), 'export const extra = 1\n')

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/base.ts']
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const shellGates = submitted.record.evaluation.deterministic.filter(
    (result) => result.type === 'shell',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.ok(shellGates.length > 0)

  for (const gate of shellGates) {
    assert.equal(gate.skipped, true, `${gate.id} was not skipped`)
    assert.equal(gate.evidence_path, undefined)
    assert.match(
      gate.explanation ?? '',
      /harness validator IMPLEMENTATION-CLAIMS-VALIDATE-001 rejected the output/u,
    )
  }

  assert.equal(existsSync(marker), false, 'a shell gate executed')
  assert.ok(
    submitted.record.evaluation.governance_artifact_warnings?.some((warning) =>
      /IMPLEMENTATION-CLAIMS-VALIDATE-001 failed: .*src\/extra\.ts/u.test(
        warning,
      ),
    ),
  )
  rmSync(markerDir, { recursive: true, force: true })
})
