import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { decideRunAsAway } from '../../src/lib/engine/decide.js'
import { traceContinuation } from '../../src/lib/intake/trace-continuation.js'
import { recordIntakeClassification } from '../../src/lib/intake/record.js'
import { sha256 } from '../../src/lib/io.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { submitCurrentStage } from './delivery-helpers.js'

const CLI = path.resolve('dist/src/cli.js')
const REQUEST = 'runtime/inbox/queue/new-interface.md'
const AUGMENTED = 'runtime/intake/new-interface/augmented.md'

for (const [sloc, route, workflow] of [
  [500, 'standard', 'standard'],
  [1500, 'decompose', 'planning'],
] as const) {
  test(`approved trace preserves its contract and original request into ${route}`, () => {
    const root = createFixture()
    const request =
      '# Original requirement\n\nPreserve the provider adapter interface.\n'
    for (const [relative, content] of [
      [REQUEST, request],
      [AUGMENTED, `${request}\nExtra implementation context.\n`],
    ]) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), content)
    }
    recordIntakeClassification({
      root,
      request: REQUEST,
      augmented: AUGMENTED,
      estimate: {
        sloc,
        tssrfs: 5,
        modules: 3,
        layers: ['cli-engine', 'library'],
        newIntegrationPoints: true,
      },
      rationale: 'New provider interface.',
    })
    const state = createRun(root, {
      workflowSlug: 'prototype-trace',
      requestPath: REQUEST,
      contextReferencePath: AUGMENTED,
    })
    assert.throws(() => traceContinuation(root, state.run_id), {
      code: 'TRACE_NOT_APPROVED',
    })
    const submitted = submitCurrentStage(
      root,
      state.run_id,
      'success',
      [],
      (output) => {
        const reference = state.request.context_reference
        assert.ok(reference)
        assert.ok(output.invocation_attestation)
        assert.ok(output.invocation_attestation.status !== 'reference_failed')
        output.invocation_attestation.context_references = [
          {
            source_path: reference.source_path,
            content_sha256: reference.content_sha256,
            status: 'read',
          },
        ]
      },
    )
    assert.equal(
      submitted.record.outcome,
      'success',
      JSON.stringify(submitted.record.evaluation),
    )
    assert.equal(submitted.state.status, 'awaiting_operator')
    const history = submitted.state.stage_history.at(-1)
    assert.ok(history?.trace_contract)
    const schema = path.join(root, history.trace_contract.schema_path)
    const original = readFileSync(schema, 'utf8')
    assert.throws(() => traceContinuation(root, state.run_id), {
      code: 'TRACE_NOT_APPROVED',
    })
    assert.throws(
      () => decideRunAsAway(root, state.run_id, 'approve', 'away'),
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )
    writeFileSync(schema, `${original}\n`)
    assert.throws(
      () => decideRun(root, state.run_id, 'approve', 'approve drift'),
      { code: 'TRACE_CONTRACT_DRIFT' },
    )
    assert.equal(getRunState(root, state.run_id).status, 'awaiting_operator')
    writeFileSync(schema, original)
    assert.equal(
      decideRun(root, state.run_id, 'approve', 'Approve schema').status,
      'succeeded',
    )
    const result = traceContinuation(root, state.run_id)
    assert.equal(result.route, route)
    assert.equal(result.workflow, workflow)
    assert.equal(result.interface_schema.sha256, sha256(original))
    assert.equal(readFileSync(path.join(root, result.request), 'utf8'), request)
    assert.equal(result.augmented_request?.path, AUGMENTED)
    assert.equal(
      result.classification,
      'runtime/intake/new-interface/classification.json',
    )
    const cli = spawnSync(
      process.execPath,
      [CLI, 'intake', 'continue', '--run', state.run_id, '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(JSON.parse(cli.stdout).trace_output, result.trace_output)
    const next = createRun(root, {
      workflowSlug: result.workflow,
      requestPath: result.request,
      contextReferencePath: result.trace_output,
      workspace: result.workspace,
    })
    const prepared = prepareInvocation(root, next.run_id)
    assert.ok(prepared.invocation)
    assert.equal(prepared.invocation.stage.slug, 'plan')
    assert.equal(next.request.sha256, state.request.sha256)
    assert.equal(
      next.request.context_reference?.source_path,
      result.trace_output,
    )
    writeFileSync(schema, `${original}\n`)
    assert.throws(() => traceContinuation(root, state.run_id), {
      code: 'TRACE_CONTRACT_DRIFT',
    })
  })
}
