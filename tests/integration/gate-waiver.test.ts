import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  assessStage,
  getRunState,
  pauseRun,
  prepareInvocation,
  setRunStage,
  waiveGate,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
import {
  BRIEFS,
  checkpoint,
  checksVariant,
  failingVerify,
  fullFailsUntil,
  fullRuns,
  PASS,
  submitStageOutput,
} from './delivery-helpers.js'

test('explicit gate waiver advances a bounded miss and tracks its spotfix case', () => {
  const {
    root,
    workflow,
    runId,
    invocation: verifyInvocation,
  } = checkpoint('delivery@verify-prepared')

  assert.ok(verifyInvocation)

  const verifyOutput = makeOutput(
    root,
    verifyInvocation,
    stageBySlug(workflow, 'verify'),
  )
  const acceptance = verifyOutput.criteria.find(
    (criterion) => criterion.id === 'verify.acceptance_met',
  )

  assert.ok(acceptance)
  acceptance.result = 'fail'
  acceptance.explanation = 'AC-9 is bounded and remains incomplete.'
  verifyOutput.result = 'failure'
  verifyOutput.data.verify = failingVerify('VF-WAIVE-1')

  writeJson(path.join(root, verifyInvocation.output.path), verifyOutput)
  writeCanonicalDelegation(root, verifyInvocation)

  const verified = submitAsSupervisor(root, runId, verifyInvocation.output.path)

  assert.equal(verified.record.outcome, 'failure')
  assert.equal(verified.state.current_stage, 'remediate')

  setRunStage(root, runId, 'verify', 'Return to the exhausted verify gate.')
  pauseRun(root, runId, 'Operator is adjudicating one bounded verify miss.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    criterionIds: ['verify.acceptance_met'],
    // AC-012: the note states the destination, so the jump past verify's
    // own verdict is the operator's stated intent rather than a default.
    note: 'Eight of nine acceptance criteria are independently complete; AC-9 is isolated to one bounded follow-up and does not invalidate the delivered behavior, so continue to ship.',
    deferredAcceptanceCriteria: ['AC-9'],
    createSpotfixCase: true,
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(
    waived.waiver.source_invocation_id,
    verifyInvocation.invocation_id,
  )
  assert.equal(waived.waiver.criterion_ids.length, 1)
  assert.ok(waived.waiver.spotfix_case_path)
  assert.ok(existsSync(path.join(root, waived.waiver.artifact_path)))
  assert.ok(
    existsSync(path.join(root, waived.waiver.spotfix_case_path ?? 'missing')),
  )
  assert.match(
    readFileSync(
      path.join(root, waived.waiver.spotfix_case_path ?? 'missing'),
      'utf8',
    ),
    /lightweight eligibility MUST be re-verified/u,
  )

  const shipInvocation = prepareInvocation(root, runId).invocation

  assert.ok(shipInvocation)
  assert.equal(shipInvocation.stage.slug, 'ship')

  const shipOutput = makeOutput(
    root,
    shipInvocation,
    stageBySlug(workflow, 'ship'),
    'success',
    getRunState(root, runId),
  )

  writeJson(path.join(root, shipInvocation.output.path), shipOutput)
  writeCanonicalDelegation(root, shipInvocation)

  const shipped = submitAsSupervisor(root, runId, shipInvocation.output.path)
  const priorGates = shipped.record.evaluation.deterministic.find(
    (criterion) => criterion.id === 'ship.prior_gates_current',
  )

  assert.equal(
    shipped.record.outcome,
    'success',
    JSON.stringify(shipped.record.evaluation),
  )
  assert.equal(shipped.state.status, 'awaiting_operator')
  assert.equal(priorGates?.passed, true)
  assert.match(
    priorGates?.explanation ?? '',
    /Operator-waived review and QA evidence/u,
  )
})

test('gate waivers can override a failed supervisor assessment', () => {
  const {
    root,
    runId,
    state: submitted,
    invocation,
    workflow,
  } = checkpoint('delivery-candidate@plan-awaiting-supervisor')

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'plan')
  assert.equal(submitted.pending_action.type, 'supervisor_assessment')

  if (submitted.pending_action.type !== 'supervisor_assessment') {
    throw new Error('Expected supervisor assessment action')
  }

  const assessmentPath = submitted.pending_action.output_path
  const criteria = stageBySlug(workflow, 'plan').criteria.map((criterion) => ({
    id: criterion.id,
    result:
      criterion.id === 'plan.complete_mapping'
        ? ('fail' as const)
        : ('pass' as const),
    evidence: [invocation.output.path],
    explanation:
      criterion.id === 'plan.complete_mapping'
        ? 'One bounded mapping remains incomplete.'
        : 'Criterion is satisfied.',
  }))

  writeJson(path.join(root, assessmentPath), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: invocation.invocation_id,
    verdict: 'fail',
    criteria,
    summary: 'One bounded plan mapping remains incomplete.',
  })
  assessStage(root, runId, assessmentPath)
  pauseRun(root, runId, 'Operator accepts the bounded plan exception.')

  const waived = waiveGate(root, runId, {
    criterionIds: ['plan.complete_mapping'],
    // The note states the destination as a word of its own. "implementation"
    // no longer confirms a route to `implement`, because a noun that happens
    // to contain a stage slug is not the operator stating the jump.
    note: 'The missing mapping is isolated, so continue to implement.',
  })

  assert.equal(waived.state.current_stage, 'implement')
  assert.equal(waived.waiver.source_evidence_path, assessmentPath)
  assert.equal(waived.waiver.criterion_ids[0], 'plan.complete_mapping')
})

test('gate waivers honor partial scope after workspace drift', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@verify-prepared',
  )

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))

  for (const criterionId of ['verify.acceptance_met', 'verify.tests_correct']) {
    const criterion = output.criteria.find((item) => item.id === criterionId)

    assert.ok(criterion)
    criterion.result = 'fail'
    criterion.explanation = `${criterionId} remains unresolved.`
  }

  output.result = 'failure'
  output.data.verify = failingVerify('VF-DRIFT-1')

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const failed = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(failed.state.current_stage, 'remediate')

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const drifted = true\n',
  )

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    criterionIds: ['verify.acceptance_met'],
    targetStage: 'ship',
    note: 'Waive only acceptance coverage. The operator accepts the separate test concern and the current workspace exactly as it stands.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
  assert.deepEqual(waived.waiver.criterion_ids, ['verify.acceptance_met'])
  assert.equal(waived.waiver.whole_stage_bypass, true)
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /whole_stage_bypass/u,
  )
  assert.notEqual(
    waived.waiver.source_workspace_fingerprint,
    waived.waiver.workspace_fingerprint,
  )
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /accepts the separate test concern and the current workspace exactly as it stands/u,
  )
})

test('explicit product failure remains blocking even when its governance output is malformed', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@verify-prepared',
  )

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))
  output.invocation_id = 'wrong-invocation-id'
  output.result = 'failure'
  output.data.verify = failingVerify('VF-MALFORMED-1')
  const acceptance = output.criteria.find(
    (criterion) => criterion.id === 'verify.acceptance_met',
  )

  assert.ok(acceptance)
  acceptance.result = 'fail'
  acceptance.explanation = 'The implementation does not meet acceptance.'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'remediate')
  assert.ok(submitted.record.evaluation.validation_errors.length > 0)
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )
})

test('gate waivers can bypass an unattempted stage', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Pre-attempt waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Operator elects not to run verification.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    note: 'Skip verification entirely and continue to ship.',
  })

  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(waived.waiver.source_attempt, 0)
  assert.deepEqual(waived.waiver.criterion_ids, ['*'])

  abortRun(root, runId, 'Initial operator decision.')
  assert.equal(getRunState(root, runId).status, 'canceled')

  const reopened = waiveGate(root, runId, {
    stageSlug: 'verify',
    targetStage: 'ship',
    note: 'Reopen the canceled run at ship. This directive supersedes the prior cancellation.',
  })

  assert.equal(reopened.state.status, 'running')
  assert.equal(reopened.state.current_stage, 'ship')
})

test('an inferred waiver names the synthesized scope criterion', () => {
  // A criterion the harness synthesizes is absent from the stage file, so
  // blocker inference over the declared criteria alone returned nothing and
  // the waiver silently widened to the whole stage.
  const { root, workflow, runId, invocation } = checkpoint(
    'delivery@verify-prepared',
  )

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  // The read-only verify stage sees an edit it cannot attribute.
  writeFileSync(path.join(root, 'src', 'outside.ts'), 'export const x = 1\n')

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const scope = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'scope.no_unapproved_changes',
  )

  assert.equal(scope?.passed, false)
  assert.equal(submitted.record.outcome, 'failure')

  setRunStage(root, runId, 'verify', 'Return to the failed verify gate.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    targetStage: 'ship',
    note: 'The operator inspected the stray file and accepts the workspace exactly as it stands.',
  })

  assert.deepEqual(waived.waiver.criterion_ids, ['scope.no_unapproved_changes'])
  assert.notEqual(waived.waiver.whole_stage_bypass, true)
})

// AC-012. The recorded case waived one evidence gap on verify while the run
// held a prepared verify card; the default route jumped to ship, discarding
// the prepared work and skipping verify's own gate the note never mentioned.
test('a waiver on a stage holding a prepared invocation stays on that stage', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared', BRIEFS)
  const before = getRunState(root, runId)

  assert.equal(before.current_stage, 'verify')
  assert.equal(before.pending_action.type, 'invoke_agent')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    note: 'The browser evidence is environment-blocked; waive that criterion only.',
  })

  assert.equal(waived.state.current_stage, 'verify')
})

// AC-003, AC-004. The entry gate runs before delegation and read no waiver,
// so an operator directive aimed at the release gate was silently ignored and
// the run stalled at the same refusal on every prepare.
test('an operator waiver reaches the ship entry gate, and a directive that cannot reach it is refused by name', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-always-fails', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [fullFailsUntil(Number.MAX_SAFE_INTEGER)] },
      configuration: { probes: [], commands: [PASS] },
    }),
  )

  const verified = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
  )

  assert.equal(verified.state.current_stage, 'ship')

  // The release gate fails on entry and routes the run away from ship.
  const routed = prepareInvocation(root, runId)

  assert.equal(routed.invocation, null)
  assert.equal(routed.state.current_stage, 'remediate')
  assert.equal(fullRuns(root), 1)
  assert.equal(routed.state.entry_gates?.ship?.last_result.passed, false)

  // A directive on another stage cannot reach the failing release gate, so it
  // is refused by that gate's name rather than accepted and then ignored.
  assert.throws(
    () =>
      waiveGate(root, runId, {
        stageSlug: 'remediate',
        targetStage: 'ship',
        note: 'The release suite failure is environment-bound; continue to ship.',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(
        'code' in error ? error.code : null,
        'WAIVER_ENTRY_GATE_UNREACHED',
      )
      assert.match(error.message, /ship\.full_suite/u)
      assert.match(error.message, /--stage ship --criteria ship\.full_suite/u)

      return true
    },
  )

  setRunStage(root, runId, 'ship', 'Return to the failed release gate.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'ship',
    criterionIds: ['ship.full_suite'],
    targetStage: 'ship',
    note: 'The release suite failure is environment-bound and reproduced outside the harness; waive the release gate and prepare the release.',
  })

  assert.deepEqual(waived.entry_gates_reached, [
    { stage: 'ship', criterion: 'ship.full_suite' },
  ])
  assert.equal(waived.state.current_stage, 'ship')

  const ship = prepareInvocation(root, runId)
  const gate = ship.state.entry_gates?.ship

  assert.ok(ship.invocation)
  assert.equal(ship.invocation.stage.slug, 'ship')
  // The criterion never ran a second time: the waiver decided the gate.
  assert.equal(fullRuns(root), 1)
  assert.ok(gate)
  assert.equal(gate.last_result.waived, true)
  assert.equal(gate.last_result.waiver_id, waived.waiver.waiver_id)
  assert.equal(gate.last_result.evidence_path, undefined)
  assert.match(
    gate.last_result.explanation ?? '',
    /waived by operator directive/u,
  )
})

test('a waiver that would skip an unnamed gate requires an explicit destination', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Unnamed destination fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Operator routes straight to verify.')

  assert.throws(
    () =>
      waiveGate(root, runId, {
        stageSlug: 'verify',
        note: 'The browser evidence is environment-blocked.',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Pass --to <stage-slug>/u)

      return true
    },
  )

  // `ship` is a substring of `relationship`, `ownership`, and `shipping`, so a
  // bare containment test accepted a note that never stated the jump — the
  // exact failure this confirmation exists to prevent.
  assert.throws(
    () =>
      waiveGate(root, runId, {
        stageSlug: 'verify',
        note: 'Environment-blocked, and this does not affect our relationship with the downstream owner.',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Pass --to <stage-slug>/u)

      return true
    },
  )

  // Either half of the confirmation is enough: the flag, or a note that says
  // where the run is going.
  const byNote = waiveGate(root, runId, {
    stageSlug: 'verify',
    note: 'Environment-blocked; route the run to ship as it stands.',
  })

  assert.equal(byNote.state.current_stage, 'ship')

  setRunStage(root, runId, 'verify', 'Return to verify for the flag half.')

  const byFlag = waiveGate(root, runId, {
    stageSlug: 'verify',
    targetStage: 'ship',
    note: 'The browser evidence is environment-blocked.',
  })

  assert.equal(byFlag.state.current_stage, 'ship')
})

test('an away-authored waiver records away authorship and never the operator', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Away-authored waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Operator routes straight to verify.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    actor: 'away',
    note: 'The browser evidence is environment-blocked by a missing Chrome for Testing bundle; route the run to ship.',
  })

  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(waived.waiver.actor, 'away')

  // AWAY-001 forbids presenting an away action as the operator's own, so the
  // artifact and the event have to say who acted.
  const artifact = readFileSync(
    path.join(root, waived.waiver.artifact_path),
    'utf8',
  )

  assert.match(artifact, /Away-mode waiver directive/u)
  assert.ok(
    !/Operator waiver directive/u.test(artifact),
    'the away waiver claims operator authorship',
  )

  const events = readFileSync(
    path.join(
      root,
      'runtime',
      'logs',
      'workflows',
      runId,
      'agent',
      'events.jsonl',
    ),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; actor?: string })

  assert.ok(
    events.some(
      (event) => event.type === 'away_gate_waived' && event.actor === 'away',
    ),
    'no away_gate_waived event was recorded',
  )
  assert.ok(
    !events.some((event) => event.type === 'operator_gate_waived'),
    'the away waiver recorded an operator waiver event',
  )
})

test('an operator waiver keeps operator authorship and records no away actor', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Operator waiver authorship fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Operator routes straight to verify.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    note: 'Environment-blocked; route the run to ship as it stands.',
  })

  assert.equal(waived.waiver.actor, undefined)
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /Operator waiver directive/u,
  )
})
