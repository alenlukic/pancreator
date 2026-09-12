import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  decideRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import { writeInboxRequest } from './delivery-helpers.js'

test('moves succeeded inbox request to complete through the full delivery workflow', () => {
  const root = createFixture()
  const initialVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const workflow = loadWorkflow(root, 'delivery')
  const requestPath = writeInboxRequest(
    root,
    'queue',
    'full-delivery.md',
    '# Full delivery\n',
  )
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath,
    title: 'Fixture run',
    involvement: 'standard',
    operatorArtifacts: true,
  })
  const runId = state.run_id
  const modelConfig = state.pipeline_config?.name

  assert.ok(modelConfig)
  assert.match(
    state.pipeline_config?.path ?? '',
    /pipeline-config\.snapshot\.json$/u,
  )

  // Delivery starts at implement: the ratified plan is the request itself.
  const stageSlugs = ['implement', 'verify', 'ship']

  for (const [stageSequence, stageSlug] of stageSlugs.entries()) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation
    const expectedPrefix = String(99 - stageSequence).padStart(2, '0')

    assert.ok(invocation)
    const brief = invocation.output.operator_brief

    assert.ok(brief)
    assert.match(
      invocation.invocation_id,
      new RegExp(`^${expectedPrefix}_${stageSlug}-1_`, 'u'),
    )
    assert.equal(invocation.stage.slug, stageSlug)
    assert.equal(invocation.stage.model_config, modelConfig)
    assert.ok(invocation.stage.model.length > 0)

    if (stageSlug === 'ship') {
      assert.equal(invocation.inputs.pr_description?.mode, 'fallback')
      assert.equal(invocation.output.artifacts?.length, 2)
      assert.match(
        invocation.output.artifacts?.[1]?.path ?? '',
        /operator\/pr-description\.md$/u,
      )
      assert.equal(
        invocation.requirements?.validation_requirements.find(
          (requirement) =>
            requirement.registry_id === 'PR-DESCRIPTION-VALIDATE-001',
        )?.resolved_target,
        invocation.output.artifacts?.[1]?.path,
      )
    }

    const invocationValidationPath = resolveRunLayout(root, runId).validation(
      `${invocation.invocation_id}.invocation-validation.json`,
    ).absolute
    assert.ok(existsSync(invocationValidationPath))

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(
      root,
      invocation,
      stage,
      'success',
      stageSlug === 'ship' ? getRunState(root, runId) : undefined,
    )

    writeJson(path.join(root, invocation.output.path), output)
    writeCanonicalDelegation(root, invocation)

    const submitted = submitAsSupervisor(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      'success',
      `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
    )
    assert.equal(existsSync(path.join(root, brief.source_path)), false)

    if (stageSlug === 'verify') {
      assert.equal(submitted.state.current_stage, 'ship')
      assert.equal(
        existsSync(
          path.join(root, 'runtime', 'inbox', `${runId}-verify-warnings.md`),
        ),
        false,
      )
    }

    if (stageSlug === 'implement') {
      const repeated = submitAsSupervisor(root, runId, invocation.output.path)

      assert.equal(repeated.idempotent, true)
      assert.equal(repeated.record.invocation_id, invocation.invocation_id)
    }

    if (stageSlug === 'ship') {
      assert.equal(submitted.state.status, 'awaiting_operator')
      rmSync(path.join(root, 'runtime/inbox/active/full-delivery.md'))
      decideRun(root, runId, 'approve', 'fixture approval')
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.equal(final.current_stage, null)
  assert.equal(final.stage_history.length, 3)
  assert.equal(
    final.request.source_path,
    'runtime/inbox/complete/full-delivery.md',
  )
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/inbox/complete/full-delivery.md'),
      'utf8',
    ),
    '# Full delivery\n',
  )
  const finalLayout = resolveRunLayout(root, runId)
  const operatorFiles = readdirSync(finalLayout.operator.absolute)

  assert.equal(existsSync(finalLayout.state.absolute), true)
  assert.equal(operatorFiles.filter((item) => item.endsWith('.html')).length, 3)
  assert.equal(
    operatorFiles.some((item) => item.endsWith('.json')),
    false,
  )
  assert.deepEqual(
    final.stage_history.map((item) => item.invocation_id.slice(0, 2)),
    ['02', '01', '00'],
  )
  assert.equal(
    existsSync(path.join(root, `runtime/logs/workflows/${runId}/records`)),
    false,
  )
  assert.ok(
    final.stage_history.every((item) => item.record_path?.endsWith('.json')),
  )
  assert.equal(
    final.stage_history.some((item) =>
      item.record_path?.endsWith('.record.md'),
    ),
    false,
  )
  assert.equal(
    readFileSync(path.join(root, 'VERSION'), 'utf8').trim(),
    nextSemanticVersion(initialVersion, 'patch'),
  )
  const shipHistory = final.stage_history.find((item) => item.stage === 'ship')
  const scopeResult = shipHistory?.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )
  const priorGateResult = shipHistory?.deterministic.find(
    (item) => item.id === 'ship.prior_gates_current',
  )

  assert.equal(scopeResult?.passed, true)
  assert.match(scopeResult?.explanation ?? '', /permitted release metadata/u)
  assert.equal(priorGateResult?.passed, true)
  assert.match(
    priorGateResult?.explanation ?? '',
    /do not invalidate the reviewed implementation fingerprint/u,
  )
})

test('restricts inbox request statuses', () => {
  const root = createFixture()
  const active = writeInboxRequest(root, 'active', 'active.md', '# Active\n')
  const complete = writeInboxRequest(
    root,
    'complete',
    'complete.md',
    '# Complete\n',
  )
  const archived = writeInboxRequest(
    root,
    'archive',
    'archived.md',
    '# Archived\n',
  )

  for (const requestPath of [active, complete, archived]) {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath,
          title: 'Forbidden fixture',
        }),
      /cannot start a run/u,
    )
  }

  const externalRun = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'External fixture',
  })

  assert.equal(externalRun.request.source_path, 'request.md')
})

test('restores claimed legacy request when brief validation fails', () => {
  const root = createFixture()
  const legacyPath = path.join(root, 'runtime/inbox/legacy.md')

  mkdirSync(path.dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, '# Legacy\n', 'utf8')
  rmSync(path.join(root, 'docs/operator-briefs/project.json'))

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'runtime/inbox/legacy.md',
        title: 'Legacy fixture',
      }),
    /Missing project brief registry/u,
  )

  assert.equal(readFileSync(legacyPath, 'utf8'), '# Legacy\n')
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/active/legacy.md')),
    false,
  )
})

test('moves aborted request to canceled and permits restart', () => {
  const root = createFixture()
  const queued = writeInboxRequest(root, 'queue', 'restart.md', '# Restart\n')
  const first = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: queued,
    title: 'Restart fixture',
  })

  rmSync(path.join(root, 'runtime/inbox/active/restart.md'))
  abortRun(root, first.run_id)

  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/canceled/restart.md')),
    true,
  )
  assert.equal(
    readFileSync(path.join(root, 'runtime/inbox/canceled/restart.md'), 'utf8'),
    '# Restart\n',
  )

  const second = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'runtime/inbox/canceled/restart.md',
    title: 'Restart fixture',
  })

  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/active/restart.md')),
    true,
  )
  assert.equal(second.request.source_path, 'runtime/inbox/active/restart.md')
})

test('keeps failed inbox request active', () => {
  const root = createFixture()
  const queued = writeInboxRequest(root, 'queue', 'failed.md', '# Failure\n')
  const workflow = loadWorkflow(root, 'preflight')
  const state = createRun(root, {
    workflowSlug: 'preflight',
    requestPath: queued,
    title: 'Failed fixture',
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
    'failure',
  )

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const failed = submitAsSupervisor(
    root,
    state.run_id,
    invocation.output.path,
  ).state

  assert.equal(failed.status, 'failed')
  assert.equal(failed.request.source_path, 'runtime/inbox/active/failed.md')
  assert.equal(
    readFileSync(path.join(root, failed.request.source_path), 'utf8'),
    '# Failure\n',
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/complete/failed.md')),
    false,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/canceled/failed.md')),
    false,
  )
})
