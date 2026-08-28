import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunState,
  prepareInvocation,
  setRunStage,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { failingVerify, submitStageOutput } from './delivery-helpers.js'

test('a failing verify verdict routes without executing the full suite', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Verify gate skip fixture',
  })
  const runId = state.run_id
  const verifyStage = stageBySlug(workflow, 'verify')

  setRunStage(root, runId, 'verify', 'Seed verification for gate-skip testing.')

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Self-criterion gate skip fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'implement', 'Seed implementation for gate skips.')

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Attestation gate skip fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'implement', 'Seed implementation for gate skips.')

  const invocation = prepareInvocation(root, runId).invocation

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Same-reason implementation fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(
    root,
    runId,
    'implement',
    'Seed implementation for direct self-loop testing.',
  )

  const first = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(first.state.status, 'running')
  assert.equal(first.state.current_stage, 'implement')
  assert.equal(first.state.same_reason_failures?.implement?.repeat_count, 1)

  const second = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.attempts.implement, 2)
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})

test('a retry may submit a merge-patch revision instead of the whole document', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Revision submission fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'implement', 'Seed a failing first attempt.')

  const first = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])
  const firstInvocationId = first.record.invocation_id
  const firstOutput = JSON.parse(
    readFileSync(
      path.join(root, first.state.stage_history[0].output_path),
      'utf8',
    ),
  ) as Record<string, Record<string, unknown>>

  assert.equal(first.record.outcome, 'failure')
  assert.equal(first.state.current_stage, 'implement')

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

test('unchanged pre-existing repository-check failures do not block implementation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Pre-existing repository failure fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "console.error('known lint failure'); process.exit(1)"`,
        ],
      },
      fast: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
    },
  })
  setRunStage(root, runId, 'implement', 'Exercise baseline-aware gates.')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.equal(baseline?.status, 'failed')
  assert.ok(baseline && existsSync(path.join(root, baseline.artifact_path)))
  assert.ok(
    invocation.inputs.references.some(
      (reference) => reference.path === baseline?.artifact_path,
    ),
  )

  const output = makeOutput(root, invocation, implementStage)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.preexisting_failure, true)
  assert.equal(staticResult?.exit_code, 1)
  assert.equal(staticResult?.baseline_evidence_path, baseline?.artifact_path)
})

test('pre-implementation baselines capture only source-mutating gate profiles', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Workflow-wide baseline fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(1)"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture workflow-wide checks.')

  submitStageOutput(root, runId, implementStage, 'success')
  const baselines = getRunState(root, runId).repository_check_baselines ?? {}

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Thorough verification fixture',
    verification: 'thorough',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(1)"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })

  setRunStage(root, runId, 'implement', 'Baseline the implement-loop profiles.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  // Even under thorough, full is never baselined before implementation: the
  // operator opted into absolute judgment, so a pre-existing failure fails
  // the gate and needs an operator decision instead of passing on a delta.
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.full,
    undefined,
  )

  setRunStage(root, runId, 'verify', 'Run verification under thorough.')
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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Repository regression fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "const fs=require('node:fs'); console.error(fs.readFileSync('src/base.ts','utf8').trim()); process.exit(1)"`,
        ],
      },
      fast: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
    },
  })
  setRunStage(root, runId, 'implement', 'Exercise regression-aware gates.')

  const invocation = prepareInvocation(root, runId).invocation
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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Large inherited failure fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')
  const largeFailure =
    `node -e "const fs=require('node:fs');` +
    `process.stderr.write(fs.readFileSync('src/diagnostics.txt','utf8'));` +
    `process.exit(1)"`

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [largeFailure] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  writeFileSync(
    path.join(root, 'src/diagnostics.txt'),
    `${Array.from({ length: 5000 }, (_, index) => `stable diagnostic ${index}`).join('\n')}\n`,
  )
  setRunStage(root, runId, 'implement', 'Compare a large inherited failure.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)

  const baselineArtifact = JSON.parse(
    readFileSync(path.join(root, baseline.artifact_path), 'utf8'),
  ) as { full_result_path?: string }

  assert.ok(baselineArtifact.full_result_path)

  writeFileSync(
    path.join(root, 'src/diagnostics.txt'),
    'stable diagnostic 2500\n',
  )

  const output = makeOutput(root, invocation, implementStage)
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/diagnostics.txt']
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.repository_check_delta?.new.length, 0)
  assert.ok(
    staticResult?.repository_check_delta?.carried.some((diagnostic) =>
      diagnostic.diagnostic.includes('stable diagnostic 2500'),
    ),
  )
  assert.equal(
    staticResult?.baseline_evidence_path,
    baselineArtifact.full_result_path,
  )
})

test('a missing baseline artifact pauses the run before delegation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Missing baseline fixture',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture baselines to delete one.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  const baseline = getRunState(root, runId).repository_check_baselines?.static

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Missing baseline map fixture',
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
  setRunStage(root, runId, 'implement', 'Capture baselines before damage.')
  submitStageOutput(root, runId, implementStage, 'success')

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
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Incompatible baseline fixture',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture baselines to corrupt one.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  const baseline = getRunState(root, runId).repository_check_baselines?.static

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
