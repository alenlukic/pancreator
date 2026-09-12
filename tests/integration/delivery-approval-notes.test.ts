import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import type { TaskRecord } from '../../src/lib/types.js'
import { read } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('a non-empty approval note becomes required context for the routed stage', () => {
  const prepared = checkpoint('delivery@implement-prepared')
  const first = prepared.invocation

  assert.ok(first)
  assert.equal(first.stage.slug, 'implement')
  assert.equal(first.stage.persona, 'coder')

  // The first stage of the run is delegated, so it owes the same delivery
  // contract and read attestation every other worker stage owes.
  assert.equal(prepared.state.pending_action.type, 'invoke_agent')
  assert.equal(first.delegation?.mode, 'referenced')
  assert.equal(
    first.delegation?.cursor_agent_path,
    '.cursor/agents/pan-coder.md',
  )
  assert.ok(first.contract_manifest)

  // The technical-director contract gates verify, so the operator stops at a
  // worker-owned stage whose approval routes to a later stage.
  const { root, runId, state } = checkpoint('delivery[td]@verify-submitted')
  const verifyHistory = state.stage_history.at(-1)

  assert.ok(verifyHistory?.record_path)

  const record = read(path.join(root, verifyHistory.record_path)) as TaskRecord
  const warnings = (record.evaluation.governance_artifact_warnings ?? []).join(
    '\n',
  )

  assert.equal(record.outcome, 'success')
  assert.doesNotMatch(warnings, /[Dd]elegation/u)
  assert.doesNotMatch(warnings, /attestation/u)

  // Worker ownership must not change where the operator stops the run.
  assert.equal(state.status, 'awaiting_operator')
  assert.equal(state.pending_action.type, 'operator_approval')
  assert.equal(state.current_stage, 'verify')

  const directive =
    'Call out the cache persistence change in the release packet.'

  decideRun(root, runId, 'approve', directive)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'approve')
  assert.equal(feedback.from_stage, 'verify')
  assert.equal(feedback.to_stage, 'ship')
  assert.equal(feedback.note, directive)
  assert.ok(existsSync(path.join(root, feedback.path)))
  assert.match(
    readFileSync(path.join(root, feedback.path), 'utf8'),
    /Operator directive attached to approval/u,
  )
  assert.equal(getRunState(root, runId).current_stage, 'ship')

  const ship = prepareInvocation(root, runId).invocation

  assert.ok(ship)
  assert.equal(ship.stage.slug, 'ship')

  const reference = ship.inputs.references.find(
    (entry) => entry.path === feedback.path,
  )

  assert.ok(reference)
  assert.equal(reference.retrieval, 'required')

  // The no-note branch routes the same way and records nothing.
  const withoutNote = checkpoint('delivery[td]@verify-submitted')

  decideRun(withoutNote.root, withoutNote.runId, 'approve')

  const plain = getRunState(withoutNote.root, withoutNote.runId)

  assert.equal(plain.current_stage, 'ship')
  assert.equal(plain.operator_feedback, undefined)
})
