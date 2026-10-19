import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

import {
  readText,
  writeJsonAtomic,
  writeTextAtomic,
  withOperationMutex,
} from '../../src/lib/io.js'
import { PanError } from '../../src/lib/errors.js'
import {
  loadState,
  eventPath,
  persist,
  statePath,
  operationMutexPath,
} from '../../src/lib/state.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { archiveWorkflowDirectories } from '../../src/lib/workflow-artifacts.js'
import {
  listProceduralExceptions,
  recordProceduralException,
  reconcileProceduralExceptions,
  resolveProceduralException,
} from '../../src/lib/procedural-exceptions.js'
import { checkpoint } from './delivery-helpers.js'
import { decideRun, prepareInvocation } from '../../src/lib/engine.js'
import {
  attestRunCard,
  makeOutput,
  writeCanonicalDelegation,
} from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { stageBySlug } from '../../src/lib/workflow.js'

const input = {
  schema_version: 1,
  client_id: 'gate-order',
  affected: 'gate-order',
  classification: 'harness_defect',
  observed_defect: 'Later-stage evidence was required early.',
  evidence: ['gate.log:1'],
  workaround: 'Run the permitted check.',
  justification: 'Preserve the gate result.',
  preserved_constraints: ['security', 'scope', 'authorization'],
  required_follow_up: 'Repair the gate dependency.',
}

test('ledger records trusted attribution, identical replay, conflict refusal and appended resolution', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  const file = path.posix.join(
    path.posix.dirname(invocation.output.path),
    '..',
    'evidence',
    `${invocation.invocation_id}-pending.json`,
  )
  writeJsonAtomic(path.join(root, file), input)
  const before = loadState(root, runId)
  const entry = recordProceduralException(root, runId, file)
  assert.equal(entry.actor.identity, invocation.stage.persona)
  assert.equal(entry.actor.invocation_id, invocation.invocation_id)
  assert.equal(entry.run_id, runId)
  assert.ok(entry.id && entry.timestamp)
  assert.equal(loadState(root, runId).status, before.status)
  assert.equal(loadState(root, runId).current_stage, before.current_stage)
  assert.equal(recordProceduralException(root, runId, file).id, entry.id)
  assert.equal(listProceduralExceptions(root, runId).length, 1)
  writeJsonAtomic(path.join(root, file), {
    ...input,
    justification: 'Different justification.',
  })
  assert.throws(
    () => recordProceduralException(root, runId, file),
    /already used/,
  )
  const recorded = readText(eventPath(root, runId))
  writeJsonAtomic(path.join(root, file), {
    outcome: 'Dependency repaired.',
    evidence: ['fix.patch'],
  })
  const resolved = resolveProceduralException(root, runId, entry.id, file)
  assert.equal(resolved.resolution?.outcome, 'Dependency repaired.')
  assert.ok(readText(eventPath(root, runId)).startsWith(recorded))
  assert.equal(
    listProceduralExceptions(root, runId, { unresolved: true }).length,
    0,
  )
  assert.equal(
    resolveProceduralException(root, runId, entry.id, file).id,
    entry.id,
  )
})

test('reconciliation imports pending records from failed outputs without accepting product claims', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  writeJsonAtomic(path.join(root, invocation.output.path), {
    result: 'failure',
    procedural_exceptions: [input],
  })
  const records = reconcileProceduralExceptions(
    root,
    runId,
    invocation.output.path,
  )
  assert.equal(records.length, 1)
  assert.equal(
    reconcileProceduralExceptions(root, runId, invocation.output.path)[0]?.id,
    records[0]?.id,
  )
  assert.equal(loadState(root, runId).status, 'running')
  const unrelated = 'runtime/unrelated.json'
  writeJsonAtomic(path.join(root, unrelated), {
    procedural_exceptions: [input],
  })
  assert.throws(
    () => reconcileProceduralExceptions(root, runId, unrelated),
    /source must be/,
  )
  writeTextAtomic(path.join(root, unrelated), '{"summary":"Historical output"}')
  assert.deepEqual(reconcileProceduralExceptions(root, runId, unrelated), [])
})

test('revision submission imports new patch records without reattributing inherited base records', () => {
  const {
    root,
    runId,
    invocation: first,
    workflow,
  } = checkpoint('planning@plan-prepared')
  assert.ok(first)
  const stage = stageBySlug(workflow, 'plan')
  const base = {
    ...makeOutput(root, first, stage),
    procedural_exceptions: [input],
  }
  base.criteria[0]!.result = 'fail'
  writeJsonAtomic(path.join(root, first.output.path), base)
  writeCanonicalDelegation(root, first)
  assert.equal(
    submitAsSupervisor(root, runId, first.output.path).record.outcome,
    'failure',
  )
  const original = listProceduralExceptions(root, runId)[0]!
  assert.equal(original.actor.invocation_id, first.invocation_id)

  decideRun(root, runId, 'revise', 'Revise the failed draft.')
  attestRunCard(root, runId)
  const { invocation: second } = prepareInvocation(root, runId)
  assert.ok(second)
  const secondOutput = makeOutput(root, second, stage)
  const inherited = {
    revises: first.invocation_id,
    patch: {
      invocation_id: second.invocation_id,
      invocation_attestation: secondOutput.invocation_attestation,
      summary:
        'Inherited pending record remains owned by its original invocation.',
    },
  }
  writeJsonAtomic(path.join(root, second.output.path), inherited)
  writeCanonicalDelegation(root, second)
  assert.deepEqual(
    reconcileProceduralExceptions(root, runId, second.output.path),
    [],
  )
  assert.equal(
    submitAsSupervisor(root, runId, second.output.path).record.outcome,
    'failure',
  )
  assert.deepEqual(listProceduralExceptions(root, runId), [original])

  for (let replay = 0; replay < 2; replay += 1) {
    reconcileProceduralExceptions(root, runId, second.output.path)
    assert.deepEqual(listProceduralExceptions(root, runId), [original])
  }
  assert.equal(
    submitAsSupervisor(root, runId, second.output.path).idempotent,
    true,
  )
  assert.deepEqual(listProceduralExceptions(root, runId), [original])

  decideRun(root, runId, 'revise', 'Retain the new recovery record.')
  attestRunCard(root, runId)
  const { invocation: third } = prepareInvocation(root, runId)
  assert.ok(third)
  const thirdOutput = makeOutput(root, third, stage)
  writeJsonAtomic(path.join(root, third.output.path), {
    revises: second.invocation_id,
    patch: {
      invocation_id: third.invocation_id,
      invocation_attestation: thirdOutput.invocation_attestation,
      procedural_exceptions: [input],
    },
  })
  writeCanonicalDelegation(root, third)
  assert.equal(
    submitAsSupervisor(root, runId, third.output.path).record.outcome,
    'failure',
  )
  const entries = listProceduralExceptions(root, runId)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], original)
  assert.equal(entries[1]?.actor.invocation_id, third.invocation_id)
  assert.notEqual(entries[1]?.id, original.id)
  assert.equal(
    reconcileProceduralExceptions(root, runId, third.output.path)[0]?.id,
    entries[1]?.id,
  )
  assert.deepEqual(listProceduralExceptions(root, runId), entries)

  decideRun(root, runId, 'revise', 'Remove pending inputs explicitly.')
  attestRunCard(root, runId)
  const { invocation: fourth } = prepareInvocation(root, runId)
  assert.ok(fourth)
  const fourthOutput = makeOutput(root, fourth, stage)
  writeJsonAtomic(path.join(root, fourth.output.path), {
    revises: third.invocation_id,
    patch: {
      invocation_id: fourth.invocation_id,
      invocation_attestation: fourthOutput.invocation_attestation,
      procedural_exceptions: null,
    },
  })
  writeCanonicalDelegation(root, fourth)
  assert.equal(
    submitAsSupervisor(root, runId, fourth.output.path).record.outcome,
    'failure',
  )
  assert.deepEqual(
    reconcileProceduralExceptions(root, runId, fourth.output.path),
    [],
  )
  assert.equal(
    submitAsSupervisor(root, runId, fourth.output.path).idempotent,
    true,
  )
  assert.deepEqual(listProceduralExceptions(root, runId), entries)
  assert.equal(
    submitAsSupervisor(root, runId, third.output.path).idempotent,
    true,
  )
  assert.deepEqual(listProceduralExceptions(root, runId), entries)
})

test('explicit reconciliation recovers an unmaterialized revision patch exactly once', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  writeJsonAtomic(path.join(root, invocation.output.path), {
    revises: 'unavailable-base',
    patch: {
      invocation_id: invocation.invocation_id,
      procedural_exceptions: [input],
    },
  })
  const [entry] = reconcileProceduralExceptions(
    root,
    runId,
    invocation.output.path,
  )
  assert.ok(entry)
  assert.equal(entry.actor.invocation_id, invocation.invocation_id)
  assert.equal(entry.client_id, input.client_id)
  assert.deepEqual(
    reconcileProceduralExceptions(root, runId, invocation.output.path),
    [entry],
  )
  assert.deepEqual(listProceduralExceptions(root, runId), [entry])
  assert.equal(loadState(root, runId).status, 'running')
})

test('retired invocation sources and supervisor evidence retain stable attribution', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  writeJsonAtomic(path.join(root, invocation.output.path), {
    procedural_exceptions: [input],
  })
  const first = reconcileProceduralExceptions(
    root,
    runId,
    invocation.output.path,
  )[0]!
  const state = loadState(root, runId)
  state.current_invocation = null
  persist(root, state, 'test_invocation_retired')
  assert.equal(
    reconcileProceduralExceptions(root, runId, invocation.output.path)[0]?.id,
    first.id,
  )
  const file = resolveRunLayout(root, runId).evidence(
    'supervisor-exception-gate.json',
  )
  writeJsonAtomic(file.absolute, input)
  const supervisor = recordProceduralException(root, runId, file.relative)
  assert.equal(supervisor.actor.role, 'supervisor')
  assert.equal(supervisor.actor.identity, 'orchestrator')
  assert.equal(
    recordProceduralException(root, runId, file.relative).id,
    supervisor.id,
  )
})

test('simultaneous identical and distinct records serialize without losing entries', async () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  const layout = resolveRunLayout(root, runId)
  const module = pathToFileURL(
    path.join(process.cwd(), 'dist/src/lib/procedural-exceptions.js'),
  ).href
  const files = ['same', 'same', 'distinct'].map((id) => {
    const file = layout.evidence(`${invocation.invocation_id}-${id}.json`)
    writeJsonAtomic(file.absolute, { ...input, client_id: id })
    return file.relative
  })
  const run = promisify(execFile)
  const receipts = await Promise.all(
    files.map((file) =>
      run(process.execPath, [
        '--input-type=module',
        '-e',
        `import { recordProceduralException } from ${JSON.stringify(module)}; console.log(recordProceduralException(${JSON.stringify(root)}, ${JSON.stringify(runId)}, ${JSON.stringify(file)}).id);`,
      ]),
    ),
  )
  assert.equal(receipts[0]!.stdout, receipts[1]!.stdout)
  assert.notEqual(receipts[0]!.stdout, receipts[2]!.stdout)
  assert.equal(listProceduralExceptions(root, runId).length, 2)
})

test('exhausted live contention preserves existing entries and retry receipts', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  const file = resolveRunLayout(root, runId).evidence(
    `${invocation.invocation_id}-bounded.json`,
  )
  writeJsonAtomic(file.absolute, input)
  const receipt = recordProceduralException(root, runId, file.relative)
  const before = listProceduralExceptions(root, runId)
  withOperationMutex(operationMutexPath(root, runId), () => {
    assert.throws(
      () => recordProceduralException(root, runId, file.relative),
      (error: unknown) =>
        error instanceof PanError && error.code === 'RUN_OPERATION_IN_PROGRESS',
    )
  })
  assert.deepEqual(listProceduralExceptions(root, runId), before)
  assert.equal(
    recordProceduralException(root, runId, file.relative).id,
    receipt.id,
  )
})

test('externalized payloads remain digest-checked and retrievable after retention moves', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  const layout = resolveRunLayout(root, runId)
  const file = layout.evidence(`${invocation.invocation_id}-large.json`)
  writeJsonAtomic(file.absolute, { ...input, client_id: 'small' })
  const small = recordProceduralException(root, runId, file.relative)
  writeJsonAtomic(file.absolute, {
    ...input,
    observed_defect: 'Evidence detail. '.repeat(6000),
  })
  const entry = recordProceduralException(root, runId, file.relative)
  assert.deepEqual(listProceduralExceptions(root, runId), [small, entry])
  const state = loadState(root, runId)
  state.status = 'failed'
  persist(root, state, 'test_run_closed')
  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 1,
    now: new Date('2200-01-01T00:00:00Z'),
  })
  assert.ok(summary.run_ids.includes(runId))
  assert.deepEqual(listProceduralExceptions(root, runId), [small, entry])
})

test('write-ahead recovery preserves the receipt and identical import after a stale state write', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')
  assert.ok(invocation)
  const before = loadState(root, runId)
  writeJsonAtomic(path.join(root, invocation.output.path), {
    procedural_exceptions: [input],
  })
  const entry = reconcileProceduralExceptions(
    root,
    runId,
    invocation.output.path,
  )[0]!
  const revision = loadState(root, runId).revision
  writeJsonAtomic(statePath(root, runId), before)
  assert.equal(loadState(root, runId).revision, revision)
  assert.equal(
    reconcileProceduralExceptions(root, runId, invocation.output.path)[0]?.id,
    entry.id,
  )
  assert.equal(listProceduralExceptions(root, runId).length, 1)
})
