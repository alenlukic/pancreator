import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun as createEngineRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import {
  attestSupervisorCard,
  buildSupervisorCard,
  redlineCurrent,
  REDLINE_FOLLOWS_ATTESTATION,
  supervisorBootstrap,
  supervisorCardAttested,
} from '../../src/lib/governance/supervisor-card.js'
import { sha256 } from '../../src/lib/io.js'
import { writeRedlineRecord } from '../../src/lib/watch.js'
import { readPolicyLookupTable } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture, makeOutput, read, writeJson } from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { checkpoint } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

const UNATTESTED_RUN_VARIANT: CheckpointVariant = {
  key: 'supervisor-card-unattested',
  createRun: (root) =>
    createEngineRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      title: 'Supervisor card fixture',
    }),
}

function unattestedRun() {
  const created = checkpoint('delivery@created', UNATTESTED_RUN_VARIANT)

  return { root: created.root, state: created.state }
}

test('pan init renders the supervisor card and records its digest in run state', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card, 'run state records the supervisor card')
  assert.equal(
    card.path,
    `runtime/logs/workflows/${state.run_id}/agent/supervisor-card.md`,
  )

  const written = readFileSync(path.join(root, card.path), 'utf8')

  assert.equal(sha256(written), card.sha256)
  assert.equal(card.attested_sha256, undefined)
  assert.match(written, /# 🤝 Run supervisor/u)
  assert.match(written, /## ✍️ Attestation/u)
  assert.ok(written.includes(`governance attest-supervisor ${state.run_id}`))

  // Every policy the lookup table resolves for the orchestrator persona is
  // inlined in full: the brief may name them by id, the card delivers them.
  const lookup = readPolicyLookupTable(root)
  const expected = new Set<string>()

  for (const row of lookup.rows) {
    if (
      (row.persona === '*' || row.persona === 'orchestrator') &&
      (row.workflow === '*' || row.workflow === 'delivery') &&
      !row.installation_scope &&
      !row.technology &&
      !row.contract &&
      !row.operator_artifacts &&
      row.long_horizon !== true
    ) {
      for (const id of row.policies) {
        expected.add(id)
      }
    }
  }

  for (const id of [
    'ORCH-001',
    'DELEGATE-001',
    'OPERATOR-001',
    'INVOCATION-001',
    'WAIVER-001',
    // Every operator-facing chat report is written by the supervisor, so the
    // chat standard reaches this card too.
    'COMMS-001',
    'STE-001',
  ]) {
    assert.ok(expected.has(id), `fixture lookup resolves ${id}`)
  }

  for (const id of expected) {
    assert.ok(written.includes(`**${id} · `), `card omits ${id}`)
  }
})

test('attesting the current digest unlocks prepare and submit; a wrong digest is refused', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card)

  // Prepare is refused while the card is unattested.
  assert.throws(
    () => prepareInvocation(root, state.run_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'SUPERVISOR_CARD_UNATTESTED' &&
      error.message.includes('governance attest-supervisor'),
  )
  assert.equal(getRunState(root, state.run_id).current_invocation, null)

  assert.throws(
    () => attestSupervisorCard(root, state.run_id, 'f'.repeat(64)),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'SUPERVISOR_CARD_DIGEST_MISMATCH',
  )

  const attested = attestSupervisorCard(
    root,
    state.run_id,
    `sha256:${card.sha256}`,
  )

  assert.equal(attested.attested_sha256, card.sha256)
  assert.ok(attested.attested_at)
  assert.equal(attested.session_generation, 1)
  assert.ok(supervisorCardAttested(getRunState(root, state.run_id)))

  // The attestation opened a supervisor session; the session's redline is
  // owed before the harness prepares anything (OPERATOR-001).
  assert.throws(
    () => prepareInvocation(root, state.run_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'REDLINE_MISSING' &&
      error.message.includes('--redline --occasion'),
  )
  assert.equal(getRunState(root, state.run_id).current_invocation, null)

  const redline = writeRedlineRecord(root, state.run_id, 'pan-start')

  assert.equal(redline.declarations[0]?.session_generation, 1)

  const prepared = prepareInvocation(root, state.run_id)

  assert.ok(prepared.invocation)
  assert.equal(
    prepared.invocation.delegation?.supervisor_card?.sha256,
    card.sha256,
  )

  const procedure = readFileSync(
    path.join(
      root,
      prepared.invocation.delegation?.supervisor_procedure_path ?? '',
    ),
    'utf8',
  )

  assert.ok(procedure.includes(card.path))
  assert.ok(
    procedure.includes(
      `attest-supervisor ${state.run_id} --sha256 ${card.sha256}`,
    ),
  )

  const workflow = loadWorkflow(root, 'delivery')
  const stage = stageBySlug(workflow, prepared.invocation.stage.slug)

  writeJson(
    path.join(root, prepared.invocation.output.path),
    makeOutput(root, prepared.invocation, stage, 'success', prepared.state),
  )

  const submitted = submitAsSupervisor(
    root,
    state.run_id,
    prepared.invocation.output.path,
  )

  assert.equal(submitted.record.outcome, 'success')
})

test('the card render is idempotent and a policy change re-binds the supervisor', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card)

  const again = buildSupervisorCard(root, state.run_id)

  assert.equal(again.changed, false)
  assert.equal(again.sha256, card.sha256)
  assert.equal(
    getRunState(root, state.run_id).supervisor_card?.rendered_at,
    card.rendered_at,
  )

  attestSupervisorCard(root, state.run_id, card.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')

  // A policy edit changes the resolved text, so the next prepare renders a new
  // digest and refuses until that digest is attested.
  const policyPath = path.join(root, 'governance/policies/ORCH-001.json')
  const policy = read(policyPath) as { instructions: string[] }

  policy.instructions = [
    ...policy.instructions,
    'The supervisor MUST re-read this card after a policy change.',
  ]
  writeJson(policyPath, policy)

  assert.throws(
    () => prepareInvocation(root, state.run_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'SUPERVISOR_CARD_UNATTESTED',
  )

  const refreshed = getRunState(root, state.run_id).supervisor_card

  assert.ok(refreshed)
  assert.notEqual(refreshed.sha256, card.sha256)
  assert.equal(refreshed.attested_sha256, card.sha256)
  assert.equal(
    sha256(readFileSync(path.join(root, refreshed.path), 'utf8')),
    refreshed.sha256,
  )

  attestSupervisorCard(root, state.run_id, refreshed.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')
  assert.ok(prepareInvocation(root, state.run_id).invocation)
})

test('a mid-run policy edit reports a digest diff and still owes re-attestation', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card)
  assert.equal(
    card.policy_section_diff,
    undefined,
    'a first render has no delta',
  )
  attestSupervisorCard(root, state.run_id, card.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')

  const policyPath = path.join(root, 'governance/policies/ORCH-001.json')
  const policy = read(policyPath) as { instructions: string[] }

  policy.instructions = [
    ...policy.instructions,
    'The supervisor MUST confirm the digest diff after a policy change.',
  ]
  writeJson(policyPath, policy)

  const refreshed = buildSupervisorCard(root, state.run_id)

  assert.equal(refreshed.changed, true)
  assert.deepEqual(refreshed.policy_section_diff?.changed, ['ORCH-001'])
  assert.deepEqual(refreshed.policy_section_diff?.added, [])
  assert.deepEqual(refreshed.policy_section_diff?.removed, [])
  assert.equal(refreshed.policy_section_diff?.previous_sha256, card.sha256)
  assert.match(refreshed.policy_diff_summary ?? '', /changed ORCH-001/u)

  // The summary names the delta; it does not excuse the re-attestation.
  let refusal: PanError | null = null

  try {
    prepareInvocation(root, state.run_id)
  } catch (error) {
    refusal = error as PanError
  }

  assert.ok(refusal instanceof PanError)
  assert.equal(refusal.code, 'SUPERVISOR_CARD_UNATTESTED')
  assert.match(refusal.message, /changed ORCH-001/u)
  assert.deepEqual(
    (refusal.details as { policy_section_diff?: { changed: string[] } })
      .policy_section_diff?.changed,
    ['ORCH-001'],
  )

  const current = getRunState(root, state.run_id).supervisor_card

  assert.ok(current)
  attestSupervisorCard(root, state.run_id, current.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')

  const prepared = prepareInvocation(root, state.run_id)

  assert.ok(prepared.invocation)

  // The delegated procedure states what the summary buys the supervisor.
  const procedure = readFileSync(
    path.join(
      root,
      prepared.invocation.delegation?.supervisor_procedure_path ?? '',
    ),
    'utf8',
  )

  assert.match(procedure, /digest-diff summary/u)
  assert.match(procedure, /Reading those blocks satisfies the re-read/u)
})

test('a resume re-attests the card, opens a new session generation, and owes a new redline', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card)
  attestSupervisorCard(root, state.run_id, card.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')
  assert.ok(prepareInvocation(root, state.run_id).invocation)

  // `/pan-resume` re-attests the unchanged digest. That is a new session.
  const resumed = attestSupervisorCard(root, state.run_id, card.sha256)

  assert.equal(resumed.session_generation, 2)

  const pointer = getRunState(root, state.run_id).current_invocation

  assert.ok(pointer)

  const invocation = read(path.join(root, pointer.json_path)) as Parameters<
    typeof makeOutput
  >[1]
  const workflow = loadWorkflow(root, 'delivery')

  writeJson(
    path.join(root, pointer.output_path),
    makeOutput(
      root,
      invocation,
      stageBySlug(workflow, invocation.stage.slug),
      'success',
      getRunState(root, state.run_id),
    ),
  )

  assert.throws(
    () => submitAsSupervisor(root, state.run_id, pointer.output_path),
    (error: unknown) =>
      error instanceof PanError && error.code === 'REDLINE_MISSING',
  )

  const redline = writeRedlineRecord(root, state.run_id, 'pan-resume')

  assert.deepEqual(
    redline.declarations.map((declaration) => declaration.session_generation),
    [1, 2],
  )
  assert.equal(redline.declarations[1]?.occasion, 'pan-resume')
  assert.equal(
    redlineCurrent(root, getRunState(root, state.run_id)).current,
    true,
  )
})

test('a run created before the card existed gains it on prepare and is bound afterwards', () => {
  const { root, state } = unattestedRun()
  const statePath = path.join(
    root,
    `runtime/logs/workflows/${state.run_id}/agent/state.json`,
  )
  const legacy = read(statePath) as Record<string, unknown>

  delete legacy.supervisor_card
  writeJson(statePath, legacy)

  const prepared = prepareInvocation(root, state.run_id)

  assert.ok(
    prepared.invocation,
    'the legacy run prepares once without attestation',
  )

  const bound = getRunState(root, state.run_id).supervisor_card

  assert.ok(bound, 'the prepare rendered the card')
  assert.ok(existsSync(path.join(root, bound.path)))

  // From here on the run is bound like any other.
  const workflow = loadWorkflow(root, 'delivery')
  const stage = stageBySlug(workflow, prepared.invocation.stage.slug)

  writeJson(
    path.join(root, prepared.invocation.output.path),
    makeOutput(root, prepared.invocation, stage, 'success', prepared.state),
  )

  assert.throws(
    () =>
      submitAsSupervisor(
        root,
        state.run_id,
        prepared.invocation?.output.path ?? '',
      ),
    (error: unknown) =>
      error instanceof PanError && error.code === 'SUPERVISOR_CARD_UNATTESTED',
  )
})

test('the supervisor card build reports what the CLI prints', () => {
  const { root, state } = unattestedRun()
  const report = buildSupervisorCard(root, state.run_id)

  assert.equal(report.attested, false)
  assert.equal(report.sha256, state.supervisor_card?.sha256)
  assert.ok(report.policies.includes('DELEGATE-001'))
  assert.ok(report.attest_command.endsWith(`--sha256 ${report.sha256}`))
})

test('a worktree-bound run names its worktree on the supervisor card', () => {
  const root = createFixture()
  const record = createWorktree(root, 'card-bound')
  const state = createEngineRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: record.path,
  })
  const card = state.supervisor_card

  assert.ok(card)

  const written = readFileSync(path.join(root, card.path), 'utf8')

  assert.match(written, /## 🌳 Workspace worktree/u)
  assert.ok(written.includes(`- Worktree: \`card-bound\``))
  assert.ok(written.includes(`- Path: \`${record.path}\``))

  // A run in the main checkout renders no worktree section.
  const plain = unattestedRun()

  assert.ok(plain.state.supervisor_card)

  const plainCard = readFileSync(
    path.join(plain.root, plain.state.supervisor_card.path),
    'utf8',
  )

  assert.ok(!plainCard.includes('## 🌳 Workspace worktree'))
})

// HR3-013: the refusal named the order, so a supervisor reading the
// bootstrap set discovered it by being refused.
test('the bootstrap command set orders the attestation before the redline and says why', () => {
  const { root, state } = unattestedRun()
  const bootstrap = supervisorBootstrap(root, state, 'pan-start')
  const keys = Object.keys(bootstrap)

  assert.ok(
    keys.indexOf('attest_command') < keys.indexOf('redline_command'),
    'the attestation is emitted before the redline',
  )
  assert.equal(bootstrap.redline_order, REDLINE_FOLLOWS_ATTESTATION)
  assert.match(bootstrap.redline_order, /after attest_command/u)
  assert.match(bootstrap.redline_order, /session generation/u)

  // The stated dependency is the one the refusal enforces.
  attestSupervisorCard(root, state.run_id, bootstrap.card_sha256 ?? '')

  const owed = supervisorBootstrap(root, getRunState(root, state.run_id))

  assert.equal(owed.attested, true)
  assert.equal(owed.redline_current, false)

  writeRedlineRecord(root, state.run_id, 'pan-start')
  assert.equal(
    supervisorBootstrap(root, getRunState(root, state.run_id)).redline_current,
    true,
  )
})

// HR3-016: the diff was measured from the previous render, so a second edit
// before any re-attestation reported only itself and the first edit left the
// supervisor's reading list unread.
test('two policy edits without an intervening attestation both appear in the diff', () => {
  const { root, state } = unattestedRun()
  const card = state.supervisor_card

  assert.ok(card)
  attestSupervisorCard(root, state.run_id, card.sha256)
  writeRedlineRecord(root, state.run_id, 'pan-start')

  const editPolicy = (id: string, instruction: string): void => {
    const policyPath = path.join(root, `governance/policies/${id}.json`)
    const policy = read(policyPath) as { instructions: string[] }

    policy.instructions = [...policy.instructions, instruction]
    writeJson(policyPath, policy)
  }

  editPolicy('ORCH-001', 'The supervisor MUST confirm the first edit.')

  const first = buildSupervisorCard(root, state.run_id)

  assert.deepEqual(first.policy_section_diff?.changed, ['ORCH-001'])

  // No attestation happens here. The supervisor has still read only the card
  // it attested, so the next delta owes it both edits.
  editPolicy('PRINCIPLES-001', 'The supervisor MUST confirm the second edit.')

  const second = buildSupervisorCard(root, state.run_id)

  assert.equal(second.changed, true)
  assert.deepEqual(second.policy_section_diff?.changed, [
    'ORCH-001',
    'PRINCIPLES-001',
  ])
  assert.equal(second.policy_section_diff?.previous_sha256, card.sha256)
  assert.match(second.policy_diff_summary ?? '', /ORCH-001/u)
  assert.match(second.policy_diff_summary ?? '', /PRINCIPLES-001/u)

  // Attesting again moves the measurement point to what was just read.
  const current = getRunState(root, state.run_id).supervisor_card

  assert.ok(current)
  attestSupervisorCard(root, state.run_id, current.sha256)
  editPolicy('ORCH-001', 'The supervisor MUST confirm the third edit.')

  const third = buildSupervisorCard(root, state.run_id)

  assert.deepEqual(third.policy_section_diff?.changed, ['ORCH-001'])
  assert.equal(third.policy_section_diff?.previous_sha256, current.sha256)
})
