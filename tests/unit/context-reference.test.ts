import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildContextReference,
  buildInvocationInputs,
  contextReferenceStatus,
} from '../../src/lib/context.js'
import { sha256 } from '../../src/lib/io.js'
import { renderContextReferenceBlock } from '../../src/lib/policy-guidance.js'
import type { ContextReference, RunState } from '../../src/lib/types.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'

const PARENT_PATH = 'runtime/specs/parent-specification.md'

function writeParent(root: string, body: string): void {
  mkdirSync(path.join(root, path.dirname(PARENT_PATH)), { recursive: true })
  writeFileSync(path.join(root, PARENT_PATH), body)
}

function runState(contextReference?: ContextReference): RunState {
  return {
    schema_version: 1,
    run_id: 'run',
    workflow_slug: 'delivery',
    workflow_snapshot: {
      path: 'runtime/logs/workflows/run/workflow.snapshot.json',
      sha256: 'workflow-sha',
    },
    workspace_root: '.',
    title: 'Context reference fixture',
    status: 'running',
    current_stage: 'implement',
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: {
      source_path: PARENT_PATH,
      stored_path: 'runtime/logs/workflows/run/request.md',
      sha256: 'request-sha',
      ...(contextReference ? { context_reference: contextReference } : {}),
    },
    limits: {
      max_total_transitions: 12,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: {},
    transition_count: 0,
    consecutive_failures: 0,
    stage_history: [],
    revision: 1,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }
}

test('a context reference digests the trimmed source', () => {
  const root = createFixture()

  writeParent(root, '\n# Parent\n\nOne requirement.\n\n')

  const reference = buildContextReference(root, PARENT_PATH)

  assert.equal(reference.source_path, PARENT_PATH)
  assert.equal(
    reference.content_sha256,
    sha256('# Parent\n\nOne requirement.'),
    'the digest basis is the trimmed selection, so a reader recomputes it',
  )
  assert.equal(reference.line_count, 3)
  assert.ok(reference.read_trigger.length > 0)
})

test('a missing context reference source is reported, not invented', () => {
  const root = createFixture()

  assert.throws(
    () => buildContextReference(root, 'runtime/specs/absent.md'),
    /Context reference source does not exist/u,
  )
})

test('context reference status separates current, drifted, and missing', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)

  assert.equal(contextReferenceStatus(root, reference), 'current')

  writeParent(root, '# Parent\n\nOne requirement, corrected.\n')
  assert.equal(contextReferenceStatus(root, reference), 'drifted')

  assert.equal(
    contextReferenceStatus(root, {
      ...reference,
      source_path: 'runtime/specs/absent.md',
    }),
    'missing',
  )
})

test('a context reference reaches the card as a required input with its status', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)
  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'implement')
  const inputs = buildInvocationInputs({
    root,
    state: runState(reference),
    stage,
    attempt: 1,
    invocationId: 'implement-1',
    workspaceFingerprint: 'fp',
  })

  assert.equal(inputs.context_reference?.source_path, PARENT_PATH)
  assert.equal(inputs.context_reference?.reference_status, 'current')
  assert.ok(
    inputs.references.some(
      (item) => item.path === PARENT_PATH && item.retrieval === 'required',
    ),
    'the parent is a required read, whatever the stage does with the request',
  )
})

test('a drifted parent is stated on the reference instead of silently refreshed', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)

  writeParent(root, '# Parent\n\nOne requirement, corrected.\n')

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'implement')
  const inputs = buildInvocationInputs({
    root,
    state: runState(reference),
    stage,
    attempt: 1,
    invocationId: 'implement-1',
    workspaceFingerprint: 'fp',
  })

  assert.equal(inputs.context_reference?.reference_status, 'drifted')
  assert.equal(
    inputs.context_reference?.content_sha256,
    reference.content_sha256,
    'the recorded digest stays put so the drift remains visible',
  )
  assert.equal(
    inputs.context_reference?.actual_content_sha256,
    sha256('# Parent\n\nOne requirement, corrected.'),
    'the on-disk digest travels with the drift report',
  )
})

test('a drifted context reference renders a reference-failure block naming both digests', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)
  const actual = sha256('# Parent\n\nOne requirement, corrected.')
  const block = renderContextReferenceBlock(
    3,
    reference,
    'drifted',
    actual,
  ).join('\n')

  assert.match(block, /- Reference status: drifted\./u)
  assert.match(block, /\*\*Reference failure · drifted\.\*\*/u)
  assert.match(
    block,
    new RegExp(`Recorded digest: \`sha256:${reference.content_sha256}\``, 'u'),
  )
  assert.match(block, new RegExp(`Actual digest: \`sha256:${actual}\``, 'u'))
  assert.match(block, /Do not attest this reference as `read`/u)

  const current = renderContextReferenceBlock(3, reference, 'current').join(
    '\n',
  )

  assert.doesNotMatch(current, /Reference failure/u)
})

test('a missing parent is reported as missing required context', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)
  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'implement')
  const inputs = buildInvocationInputs({
    root,
    state: runState({ ...reference, source_path: 'runtime/specs/absent.md' }),
    stage,
    attempt: 1,
    invocationId: 'implement-1',
    workspaceFingerprint: 'fp',
  })

  assert.ok(inputs.missing_required?.includes('runtime/specs/absent.md'))
})

test('the context reference block carries path, digest, basis, and trigger', () => {
  const root = createFixture()

  writeParent(root, '# Parent\n\nOne requirement.\n')

  const reference = buildContextReference(root, PARENT_PATH)
  const block = renderContextReferenceBlock(3, reference, 'current').join('\n')

  assert.match(block, /^\n### Context reference · `runtime\/specs/u)
  assert.match(block, /- Read when: /u)
  assert.match(block, /- Selected range: the complete file\./u)
  assert.match(block, new RegExp(`sha256:${reference.content_sha256}`, 'u'))
  assert.match(block, /- Digest basis: SHA-256 of the selected text/u)
  assert.match(block, /- Reference status: current\./u)
})
