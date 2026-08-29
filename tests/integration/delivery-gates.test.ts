import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunState,
  prepareInvocation,
  setRunStage,
  submitOutput,
} from '../../src/lib/engine.js'
import { compareRepositoryCheckToBaseline } from '../../src/lib/repository-checks.js'
import type { RepositoryCheckResult } from '../../src/lib/repository-checks.js'
import { loadRepositoryCheckBaseline } from '../../src/lib/validation.js'
import type { RunState } from '../../src/lib/types.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import {
  checkpoint,
  checksVariant,
  failingVerify,
  submitStageOutput,
} from './delivery-helpers.js'

const PASS = `node -e "process.exit(0)"`

/** Every gated profile green: the shape the baseline-damage tests corrupt. */
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

  // Contamination detection is outcome-independent: the scope state criterion
  // still evaluates even when every shell gate is skipped.
  const scope = failed.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.skipped, undefined)
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

  const submitted = submitOutput(root, runId, invocation.output.path)

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
  // The retry card names the prior invocation and teaches the revision form.
  const card = readFileSync(
    path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /"revises"/u)
  assert.ok(card.includes(firstInvocationId))

  // Author attempt 2's brief (paths differ per attempt), then submit only a
  // patch: flip the verdicts, attest to the new card, add the remediation.
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

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')

  const historyItem = submitted.state.stage_history.find(
    (item) => item.invocation_id === invocation.invocation_id,
  )

  assert.equal(historyItem?.revised_from, firstInvocationId)

  // The merged document carries attempt 1's untouched content plus the patch.
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

  // Resubmitting the same patch is idempotent.
  const replay = submitOutput(root, runId, invocation.output.path)

  assert.equal(replay.idempotent, true)
})

test('pre-implementation baselines capture only source-mutating gate profiles', () => {
  // Capture happens at prepare, so the prepared checkpoint already holds the
  // baselines; no submission is needed to observe which profiles were kept.
  const { state } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=static,fast,full-fails,configuration', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [`node -e "process.exit(1)"`] },
      configuration: { probes: [], commands: [PASS] },
    }),
  )
  const baselines = state.repository_check_baselines ?? {}

  assert.equal(baselines.static?.status, 'passed')
  assert.equal(baselines.fast?.status, 'passed')
  // Baselines answer one question — did this run's own edits break a check —
  // so only the implement loop's profiles are captured. The expensive `full`
  // profile and the ship-stage configuration check never run before the coder
  // starts; their gates are judged on their own results.
  assert.equal(baselines.full, undefined)
  assert.equal(baselines.configuration, undefined)
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

  // The paused run must stay loadable: the persisted state digest has to match
  // the referenced state artifact after the baseline pointer is cleared.
  const reloaded = getRunState(root, state.run_id)

  assert.equal(reloaded.status, 'paused')
  assert.equal(reloaded.revision, prepared.state.revision)
})

test('the default light level gates verification on the fast profile and never runs full', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Light verification fixture',
  })
  const runId = state.run_id
  const fullMarker = path.join(root, 'runtime', 'full-ran.txt')

  assert.equal(state.verification?.level, 'light')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: {
        probes: [],
        commands: [
          `node -e "require('node:fs').appendFileSync('runtime/full-ran.txt','x'); process.exit(1)"`,
        ],
      },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })

  setRunStage(root, runId, 'implement', 'Baseline the implement-loop profiles.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

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
  assert.equal(fullSuite.command, 'pan repository-check fast')
  assert.equal(fullSuite.verification_level, 'light')
  assert.equal(fullSuite.passed, true)
  assert.equal(submitted.record.outcome, 'success')
  // The broken full profile never executed at any point in the run.
  assert.equal(existsSync(fullMarker), false)
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

  // Even under thorough, full is never baselined before implementation: the
  // operator opted into absolute judgment, so a pre-existing failure fails
  // the gate and needs an operator decision instead of passing on a delta.
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
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
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
  writeJson(path.join(root, first.output.path), output)
  writeCanonicalDelegation(root, first)

  const inherited = submitOutput(root, runId, first.output.path)
  const beforeRepair = inherited.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(beforeRepair?.passed, true)
  assert.equal(beforeRepair?.preexisting_failure, true)

  // The same worker now repairs the inherited failure and submits the same stage
  // output again. Credit for the repair must not need an operator waiver.
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

  const submitted = submitOutput(root, runId, second.output.path)
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

test('an elided inherited failure stays carried from the full baseline', () => {
  // The gate compares against the untruncated baseline when the inline result
  // was elided, so the comparison is exercised directly on a baseline artifact
  // whose inline result is elided and whose full_result_path holds the truth.
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-elided-'))
  const diagnostics = Array.from(
    { length: 5000 },
    (_, index) => `stable diagnostic ${index}`,
  )
  const check = (stderr: string): RepositoryCheckResult => ({
    profile: 'static',
    status: 'failed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: '.',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'node -e "..."',
        exit_code: 1,
        signal: null,
        stdout: '',
        stderr,
        passed: false,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  })
  const artifactDirectory = 'runtime/logs/workflows/run-1/agent/artifacts/json'
  const summaryPath = `${artifactDirectory}/baseline-static.json`
  const fullPath = `${artifactDirectory}/baseline-static.full.json`
  const artifact = (result: RepositoryCheckResult, full?: string) => ({
    schema_version: 1,
    run_id: 'run-1',
    stage: 'implement',
    profile: 'static',
    workspace_fingerprint: 'fixture',
    recorded_at: '2026-08-24T00:00:00.000Z',
    result,
    ...(full ? { full_result_path: full } : {}),
  })

  mkdirSync(path.join(root, artifactDirectory), { recursive: true })
  writeJson(
    path.join(root, summaryPath),
    artifact(
      check(
        `${diagnostics.slice(0, 10).join('\n')}\n…[bytes elided; see the full result artifact]…\n`,
      ),
      fullPath,
    ),
  )
  writeJson(
    path.join(root, fullPath),
    artifact(check(`${diagnostics.join('\n')}\n`)),
  )

  const state = {
    repository_check_baselines: {
      static: {
        profile: 'static',
        status: 'failed',
        artifact_path: summaryPath,
        workspace_fingerprint: 'fixture',
        recorded_at: '2026-08-24T00:00:00.000Z',
      },
    },
  } as unknown as RunState
  const baseline = loadRepositoryCheckBaseline(root, state, 'static')

  assert.ok(baseline.result)
  assert.equal(baseline.artifact_path, fullPath)

  const staticResult = compareRepositoryCheckToBaseline(
    baseline.result,
    check('stable diagnostic 2500\n'),
  )

  assert.equal(staticResult.passed, true)
  assert.equal(staticResult.delta.new.length, 0)
  assert.ok(
    staticResult.delta.carried.some((diagnostic) =>
      diagnostic.diagnostic.includes('stable diagnostic 2500'),
    ),
  )

  rmSync(root, { recursive: true, force: true })
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

  // A gate judged against a baseline cannot run without it, and the worker
  // cannot influence that fault, so the stage attempt must not be spent.
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

  // The capture-once invariant holds: nothing is recaptured after
  // implementation. An absent pointer under a verification level means the
  // gate is judged on its own result instead of failing closed, so the run
  // proceeds without an operator pause.
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

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  // A green exit code is not evidence of parity when the comparison the gate
  // depends on cannot be made.
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
