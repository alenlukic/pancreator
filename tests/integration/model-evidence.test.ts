import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  probeRunInvocationModel,
  recordSupervisorModelEvidence,
  submitOutput,
} from '../../src/lib/engine.js'
import { expectedCursorModelForSpec } from '../../src/lib/executors/cursor-probe.js'
import { stageBySlug, loadWorkflow } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

function withFakeCursorAgent<T>(
  root: string,
  model: string | null,
  operation: () => T,
): T {
  const bin = path.join(root, 'fake-bin')
  const executable = path.join(bin, 'cursor-agent')
  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    model
      ? `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
          type: 'system',
          subtype: 'init',
          model,
        })}'\n`
      : '#!/bin/sh\nexit 0\n',
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`

  try {
    return operation()
  } finally {
    process.env.PATH = priorPath
  }
}

test('supervisor evidence activates future worker-card enforcement', () => {
  const legacyRoot = createFixture()
  const legacyRun = createRun(legacyRoot, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Markerless compatibility run',
  })
  const legacyInvocation = prepareInvocation(
    legacyRoot,
    legacyRun.run_id,
  ).invocation

  assert.ok(legacyInvocation)
  assert.equal(legacyInvocation.model_evidence_required, undefined)
  const legacyStage = stageBySlug(
    loadWorkflow(legacyRoot, 'dev'),
    legacyInvocation.stage.slug,
  )

  writeJson(
    path.join(legacyRoot, legacyInvocation.output.path),
    makeOutput(legacyRoot, legacyInvocation, legacyStage),
  )
  writeCanonicalDelegation(legacyRoot, legacyInvocation)
  submitOutput(legacyRoot, legacyRun.run_id, legacyInvocation.output.path)
  decideRun(legacyRoot, legacyRun.run_id, 'approve')
  recordSupervisorModelEvidence(
    legacyRoot,
    legacyRun.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const laterLegacyInvocation = prepareInvocation(
    legacyRoot,
    legacyRun.run_id,
  ).invocation

  assert.ok(laterLegacyInvocation)
  assert.equal(laterLegacyInvocation.model_evidence_required, undefined)

  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Model evidence run',
  })
  const evidence = recordSupervisorModelEvidence(
    root,
    run.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  assert.equal(evidence.role, 'supervisor')
  assert.equal(evidence.result, 'recorded')
  assert.ok(evidence.evidence_path.endsWith('.json'))
  assert.equal(getRunState(root, run.run_id).model_evidence?.length, 1)
  assert.throws(
    () =>
      recordSupervisorModelEvidence(
        root,
        run.run_id,
        'Different Model',
        'Cursor session metadata',
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('already records supervisor model'),
  )

  const prepared = prepareInvocation(root, run.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.model_evidence_required, true)

  const stage = stageBySlug(loadWorkflow(root, 'dev'), 'intake')

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  assert.throws(
    () => submitOutput(root, run.run_id, invocation.output.path),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('no usable worker model evidence'),
  )
})

test('worker probes persist matches and reject mismatches or missing metadata', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Worker probe run',
  })

  recordSupervisorModelEvidence(
    root,
    run.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const matching = withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(matching.result, 'match')
  assert.equal(matching.effective_model, expected)

  assert.throws(
    () =>
      withFakeCursorAgent(root, 'Unexpected Model', () =>
        probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
      ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('run snapshot expects'),
  )
  assert.throws(
    () =>
      withFakeCursorAgent(root, null, () =>
        probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
      ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('no system/init event'),
  )

  // A repaired probe supersedes the failed evidence, so the marked card
  // submits once the recorded worker model matches the run snapshot.
  assert.equal(invocation.model_evidence_required, true)

  const repaired = withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(repaired.result, 'match')

  const stage = stageBySlug(loadWorkflow(root, 'dev'), invocation.stage.slug)

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})
