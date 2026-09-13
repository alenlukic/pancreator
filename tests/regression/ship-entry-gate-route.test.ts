/**
 * Run `63297_Sep-12-0826_critical-pat` failed its `ship.full_suite` entry
 * gate, and the harness routed it to `remediate`. The remediation the harness
 * itself ordered changed the workspace, so the direct return to `ship` failed
 * `ship.prior_gates_current` against the pre-remediation fingerprint. The
 * supervisor recovered with `pan resume --stage verify`, an operator command
 * the harness had made unavoidable.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getRunState, prepareInvocation } from '../../src/lib/engine.js'
import { fixtureGit } from '../fixture-template.js'
import { evaluateStateCriterion } from '../../src/lib/validation.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  fullFailsUntil,
  fullRuns,
  PASS,
  submitStageOutput,
} from '../integration/delivery-helpers.js'
import type { CheckpointVariant } from '../integration/delivery-helpers.js'
import { attachTargetInstructionEvidence, writeJson } from '../helpers.js'
import type {
  Criterion,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'

const OPERATOR_EVENT_TYPES = new Set([
  'run_paused',
  'run_resumed',
  'stage_changed',
  'operator_decision_recorded',
])

const FULL_FAILS_ONCE = {
  static: { probes: [], commands: [PASS] },
  fast: { probes: [], commands: [PASS] },
  full: { probes: [], commands: [fullFailsUntil(1)] },
  configuration: { probes: [], commands: [PASS] },
}

function writeChecks(root: string): void {
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: FULL_FAILS_ONCE,
  })
}

function recordedEventTypes(root: string, runId: string): string[] {
  const events = path.join(
    root,
    'runtime/logs/workflows',
    runId,
    'agent/events.jsonl',
  )

  return readFileSync(events, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { type: string }).type)
}

test('a harness-routed entry-gate repair reaches release with no operator command', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared', {
    key: 'checks=full-fails-once',
    fixture: writeChecks,
  })
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  submitStageOutput(root, runId, verifyStage, 'success')

  const routed = prepareInvocation(root, runId)

  assert.equal(routed.invocation, null)
  assert.equal(routed.state.current_stage, 'remediate')
  assert.equal(routed.state.entry_gates?.ship?.failures, 1)
  assert.equal(routed.state.entry_gates?.ship?.repair_stage, 'remediate')
  assert.equal(routed.state.entry_gates?.ship?.routed_to, undefined)

  // The repair the gate ordered changes the workspace, which is exactly what
  // invalidates the verify evidence `ship.prior_gates_current` reads.
  const remediated = submitStageOutput(
    root,
    runId,
    remediateStage,
    'success',
    [],
    (output) => {
      writeFileSync(
        path.join(root, 'src/repaired.ts'),
        'export const repaired = true\n',
      )
      output.workspace_changes = {
        attribution: 'internal',
        paths: ['src/repaired.ts'],
        explanation: 'The remediation the entry gate ordered changed this.',
      }
      attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
    },
  )

  assert.equal(remediated.record.outcome, 'success')
  assert.equal(
    remediated.state.current_stage,
    'verify',
    'the repair must return through the stage that retakes the evidence',
  )

  const reverified = submitStageOutput(root, runId, verifyStage, 'success')

  assert.equal(reverified.state.current_stage, 'ship')

  const ship = prepareInvocation(root, runId)

  assert.ok(ship.invocation, 'the run must reach its release invocation')
  assert.equal(ship.state.current_stage, 'ship')
  assert.equal(fullRuns(root), 2)
  assert.equal(ship.state.entry_gates?.ship?.last_result.passed, true)
  assert.deepEqual(
    recordedEventTypes(root, runId).filter((type) =>
      OPERATOR_EVENT_TYPES.has(type),
    ),
    [],
    'the run must reach release with no pause, set-stage, or resume',
  )
})

test('an unsatisfiable repair route is reported rather than taken', () => {
  // Sever the repair stage's success path so no route returns to ship. The
  // fixture runs before the run exists, so the snapshot carries the sever.
  const severed: CheckpointVariant = {
    key: 'checks=full-fails-once,remediate-terminates',
    fixture: (root) => {
      writeChecks(root)

      const stagePath = path.join(
        root,
        'library/workflows/delivery/stages/remediate.json',
      )
      const remediate = JSON.parse(readFileSync(stagePath, 'utf8')) as {
        transitions: Record<string, string>
      }

      remediate.transitions.success = 'succeeded'
      writeJson(stagePath, remediate)
      // The sever edits a tracked file, so it belongs to the baseline commit
      // rather than to any stage of the run.
      fixtureGit(['add', '.'], { cwd: root, encoding: 'utf8' })
      fixtureGit(['commit', '-qm', 'sever repair route'], {
        cwd: root,
        encoding: 'utf8',
      })
    },
  }
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    severed,
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  const reported = prepareInvocation(root, runId)

  assert.equal(reported.invocation, null)
  assert.equal(reported.state.status, 'paused')
  assert.equal(
    reported.state.current_stage,
    'ship',
    'an unsatisfiable route leaves the run at the gate it failed',
  )
  assert.match(
    reported.state.pause_reason ?? '',
    /cannot return the run to a stage that satisfies 'ship\.prior_gates_current'/u,
  )
  assert.equal(getRunState(root, runId).entry_gates?.ship?.routed_to, undefined)
})

test('a stale verify fingerprint still fails the release currency criterion', () => {
  // The repair returns through verify rather than adding an exception to the
  // criterion, so a fingerprint stale for any other reason still fails.
  const criterion: Criterion = {
    id: 'ship.prior_gates_current',
    type: 'state',
    hard: true,
    statement: 'Verification is satisfied by current successful evidence.',
  }
  const verify: StageHistoryItem = {
    stage: 'verify',
    attempt: 1,
    invocation_id: 'verify-1',
    output_path: 'runtime/logs/workflows/run-1/outputs/verify-1.json',
    outcome: 'success',
    submitted_at: '2026-09-12T00:00:00.000Z',
    workspace_fingerprint: 'fp-before-an-unrelated-edit',
    validation_errors: [],
    deterministic: [],
  }
  const state = {
    stage_history: [verify],
    accepted_workspace_fingerprint: null,
    operator_gate_waivers: [],
    entry_gates: {},
  } as unknown as RunState

  const result = evaluateStateCriterion(state, criterion, 'fp-current')

  assert.equal(result.passed, false)
})
