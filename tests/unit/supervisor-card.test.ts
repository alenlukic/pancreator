import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
  supervisorCardAttested,
} from '../../src/lib/governance/supervisor-card.js'
import { sha256 } from '../../src/lib/io.js'
import { readPolicyLookupTable } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  read,
  submitAsSupervisor,
  writeJson,
} from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function pan(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })

  return result
}

function unattestedRun(root: string) {
  return createEngineRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Supervisor card fixture',
  })
}

test('pan init renders the supervisor card and records its digest in run state', () => {
  const root = createFixture()
  const state = unattestedRun(root)
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
      !row.operator_artifacts
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
  ]) {
    assert.ok(expected.has(id), `fixture lookup resolves ${id}`)
  }

  for (const id of expected) {
    assert.ok(written.includes(`**${id} · `), `card omits ${id}`)
  }
})

test('pan prepare and pan submit refuse an unattested supervisor card', () => {
  const root = createFixture()
  const state = unattestedRun(root)

  assert.throws(
    () => prepareInvocation(root, state.run_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'SUPERVISOR_CARD_UNATTESTED' &&
      error.message.includes('governance attest-supervisor'),
  )

  // Nothing was prepared while the refusal stood.
  assert.equal(getRunState(root, state.run_id).current_invocation, null)
})

test('attesting the current digest unlocks prepare and submit; a wrong digest is refused', () => {
  const root = createFixture()
  const state = unattestedRun(root)
  const card = state.supervisor_card

  assert.ok(card)
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
  assert.ok(supervisorCardAttested(getRunState(root, state.run_id)))

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
  const root = createFixture()
  const state = unattestedRun(root)
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
  assert.ok(prepareInvocation(root, state.run_id).invocation)
})

test('a run created before the card existed gains it on prepare and is bound afterwards', () => {
  const root = createFixture()
  const state = unattestedRun(root)
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

test('the CLI renders, reports, and attests the supervisor card', () => {
  const root = createFixture()
  const state = unattestedRun(root)
  const rendered = pan(root, [
    'governance',
    'card',
    '--mode',
    'supervisor',
    '--run',
    state.run_id,
  ])

  assert.equal(rendered.status, 0, rendered.stderr)

  const report = JSON.parse(rendered.stdout) as {
    mode: string
    sha256: string
    attested: boolean
    attest_command: string
    policies: string[]
  }

  assert.equal(report.mode, 'supervisor')
  assert.equal(report.attested, false)
  assert.equal(report.sha256, state.supervisor_card?.sha256)
  assert.ok(report.policies.includes('DELEGATE-001'))
  assert.ok(report.attest_command.endsWith(`--sha256 ${report.sha256}`))

  const refused = pan(root, ['prepare', state.run_id])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr + refused.stdout, /SUPERVISOR_CARD_UNATTESTED/u)

  const attested = pan(root, [
    'governance',
    'attest-supervisor',
    state.run_id,
    '--sha256',
    report.sha256,
  ])

  assert.equal(attested.status, 0, attested.stderr)
  assert.equal(
    (JSON.parse(attested.stdout) as { status: string }).status,
    'attested',
  )

  const prepared = pan(root, ['prepare', state.run_id])

  assert.equal(prepared.status, 0, prepared.stderr)
})
